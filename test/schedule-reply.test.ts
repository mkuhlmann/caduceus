import { describe, expect, test } from 'bun:test'
import { ApiError } from '@/lib/http'
import type { Message } from '@/lib/gateway'
import {
	OUTPUT_CAP,
	REPLY_DIVIDER,
	SCHEDULE_REFUSAL,
	capOutput,
	hasRunContext,
	isScheduleChat,
	isScheduleRefusal,
	needsJobLookup,
	replyChatTitle,
	runOutput,
	scheduleJobName,
	withRunContext,
} from '@/lib/schedule-reply'

const user = (id: number, text: string): Message => ({ id, role: 'user', content: text })
const say = (id: number, text: string): Message => ({ id, role: 'assistant', content: text })
const call = (id: number): Message => ({
	id,
	role: 'assistant',
	content: '',
	tool_calls: [{ id: `c${id}`, function: { name: 'terminal', arguments: '{}' } }],
})
const result = (id: number): Message => ({ id, role: 'tool', content: 'ok', tool_call_id: `c${id - 1}` })

describe('telling a schedule chat', () => {
	test('a chat a schedule wrote is one, as History files it under the Schedule channel', () => {
		expect(isScheduleChat({ source: 'cron' })).toBe(true)
		expect(isScheduleChat({ source: 'api_server' })).toBe(false)
		expect(isScheduleChat({ source: 'telegram' })).toBe(false)
		expect(isScheduleChat({})).toBe(false)
		expect(isScheduleChat(undefined)).toBe(false)
	})

	test("Hermes' refusal is known by its code, wherever it comes", () => {
		expect(isScheduleRefusal(new ApiError('This chat belongs to a scheduled job', 409, SCHEDULE_REFUSAL))).toBe(true)
		expect(isScheduleRefusal({ error: { message: 'no', code: SCHEDULE_REFUSAL } })).toBe(true)
		expect(isScheduleRefusal({ error_surface: { layer: 'gateway', code: SCHEDULE_REFUSAL, retryable: false } })).toBe(
			true,
		)
		expect(isScheduleRefusal(new ApiError('Forbidden', 409, 'permission_denied'))).toBe(false)
		expect(isScheduleRefusal(new Error('This chat belongs to a scheduled job'))).toBe(false)
		expect(isScheduleRefusal(null)).toBe(false)
		expect(isScheduleRefusal('cron_session_read_only')).toBe(false)
	})
})

describe('naming the job and its reply chat', () => {
	test('the job is read off the title Hermes gives a run', () => {
		expect(scheduleJobName('MANHUNT Gewinnspiel · Nov 18 09:00')).toBe('MANHUNT Gewinnspiel')
		expect(scheduleJobName('Morning briefing · Feb 3 7:00 #2')).toBe('Morning briefing')
		// A dot inside the name stays: only the last part is the time.
		expect(scheduleJobName('Backups · NAS · Jan 01 02:30')).toBe('Backups · NAS')
	})

	test('a title that only names the job id is looked up among the jobs', () => {
		const jobs = [{ id: 'a1b2', name: 'Nightly backup report' }]
		expect(needsJobLookup('cron a1b2')).toBe(true)
		expect(needsJobLookup('Nightly backup report · Nov 18 02:30')).toBe(false)
		expect(scheduleJobName('cron a1b2', jobs)).toBe('Nightly backup report')
		expect(scheduleJobName('cron zz99', jobs)).toBe('cron zz99')
	})

	test('any other title is the name, and none at all still reads', () => {
		expect(scheduleJobName('Something renamed')).toBe('Something renamed')
		expect(scheduleJobName(null)).toBe('Scheduled job')
		expect(scheduleJobName('  ')).toBe('Scheduled job')
	})

	test('the reply chat is named after the job, one per job', () => {
		expect(replyChatTitle('MANHUNT Gewinnspiel')).toBe('Reply to MANHUNT Gewinnspiel')
		expect(replyChatTitle(' Morning briefing ')).toBe('Reply to Morning briefing')
		expect(replyChatTitle('')).toBe('Reply to Scheduled job')
	})
})

describe('what a run produced', () => {
	test("the agent's last words in the run, past its tool calls", () => {
		const ms = [user(1, 'Check the contest'), call(2), result(3), say(4, 'Draft ready. Send it?')]
		expect(runOutput(ms)).toBe('Draft ready. Send it?')
	})

	test('messages typed into the chat afterwards, and refused, are not the output', () => {
		const ms = [user(1, 'Check the contest'), say(2, 'Draft ready. Send it?'), user(3, 'send it'), say(4, 'Refused')]
		expect(runOutput(ms)).toBe('Draft ready. Send it?')
	})

	test('hidden and system messages are passed over; a run without words has none', () => {
		const hidden: Message = { id: 3, role: 'assistant', content: 'internal', display_kind: 'hidden' }
		expect(runOutput([user(1, 'go'), say(2, 'Done.'), hidden])).toBe('Done.')
		expect(runOutput([user(1, 'go'), call(2), result(3)])).toBe('')
		expect(runOutput([])).toBe('')
	})

	test('multimodal content is read as its text', () => {
		const ms: Message[] = [
			user(1, 'go'),
			{ id: 2, role: 'assistant', content: [{ type: 'text', text: 'Chart attached' }] },
		]
		expect(runOutput(ms)).toBe('Chart attached')
	})
})

describe('capping the output', () => {
	test('a short output is kept whole', () => {
		expect(capOutput('  all good  ')).toBe('all good')
	})

	test('a long one keeps its start and its end, within the cap, and says how much is left out', () => {
		const long = `START ${'x'.repeat(9000)} Should I send it?`
		const capped = capOutput(long)
		expect(capped.length).toBeLessThanOrEqual(OUTPUT_CAP)
		expect(capped.startsWith('START')).toBe(true)
		expect(capped.endsWith('Should I send it?')).toBe(true)
		const left = Number(/\[… (\d+) characters left out …\]/.exec(capped)?.[1])
		expect(left).toBeGreaterThan(5000)
	})

	test('the end gets more room than the start', () => {
		const capped = capOutput('a'.repeat(5000) + 'b'.repeat(5000), 1000)
		expect(capped.length).toBeLessThanOrEqual(1000)
		expect(capped.split('b').length - 1).toBeGreaterThan(capped.split('a').length - 1)
	})
})

describe("a reply's context", () => {
	const ctx = {
		jobName: 'MANHUNT Gewinnspiel',
		ranAt: '18 Nov 2026, 09:00',
		runChatId: 'cron_abc',
		output: 'Draft ready.',
	}

	test('header, the run output, a divider, then the message, in that order', () => {
		const text = withRunContext(ctx, 'schick ab')
		expect(text).toBe(
			'This replies to the run from 18 Nov 2026, 09:00 of the scheduled job "MANHUNT Gewinnspiel" (run chat cron_abc).\n' +
				'What the run produced:\n\nDraft ready.\n\n---\n\nschick ab',
		)
	})

	test('the output in it is capped, and the message is never cut', () => {
		const message = 'm'.repeat(6000)
		const text = withRunContext({ ...ctx, output: 'o'.repeat(20_000) }, message)
		const [head, ...rest] = text.split(`\n\n${REPLY_DIVIDER}\n\n`)
		expect(rest.join('')).toBe(message)
		expect(head!.split('\n\n').slice(1).join('\n\n').length).toBeLessThanOrEqual(OUTPUT_CAP)
	})

	test('without a time or an output it still says which job it is', () => {
		const text = withRunContext({ jobName: 'Backups', runChatId: 'r1', output: '' }, 'again please')
		expect(text).toBe(
			'This replies to the run of the scheduled job "Backups" (run chat r1).\nThe run produced no text.\n\n---\n\nagain please',
		)
	})

	test('a reply chat that holds a run context already takes messages as written', () => {
		const sent = withRunContext(ctx, 'schick ab')
		expect(hasRunContext(['hello', sent], 'cron_abc')).toBe(true)
		// A later run of the same job is a different run chat: its context goes along again.
		expect(hasRunContext(['hello', sent], 'cron_def')).toBe(false)
		expect(hasRunContext([], 'cron_abc')).toBe(false)
	})
})
