import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
	audience,
	failedRuns,
	liveChanges,
	NotifyPatchSchema,
	preview,
	roomAsk,
	tagOfRoute,
	botNotice,
	chatNotice,
	roomNotice,
} from '@/lib/notifications'

test('the first look at live chats only learns what runs', () => {
	const { seen, changes } = liveChanges(undefined, [{ id: 'a', status: 'waiting' }])
	expect(changes).toEqual([])
	expect(seen).toEqual({ a: 'waiting' })
})

test('a turn that starts waiting is news once', () => {
	const first = liveChanges({ a: 'working' }, [{ id: 'a', status: 'waiting' }])
	expect(first.changes).toEqual([{ id: 'a', change: 'waiting' }])
	expect(liveChanges(first.seen, [{ id: 'a', status: 'waiting' }]).changes).toEqual([])
})

test('a busy turn that goes idle or leaves the list is done', () => {
	expect(liveChanges({ a: 'working' }, [{ id: 'a', status: 'idle' }]).changes).toEqual([{ id: 'a', change: 'done' }])
	expect(liveChanges({ a: 'waiting' }, []).changes).toEqual([{ id: 'a', change: 'done' }])
	// Idle before and idle now, or gone while idle, is nothing.
	expect(liveChanges({ a: 'idle', b: 'idle' }, [{ id: 'a', status: 'idle' }]).changes).toEqual([])
	// Answered and back to work is not done.
	expect(liveChanges({ a: 'waiting' }, [{ id: 'a', status: 'working' }]).changes).toEqual([])
})

const ask = (seq: number, text: string, who = 'Scout') => ({
	seq,
	kind: 'message.member',
	payload: { text },
	actor: { display_name: who },
})
const user = (seq: number) => ({ seq, kind: 'message.user', payload: { text: 'ok' } })

test('a room asks when a bot hands something to the user after their last message', () => {
	const a = roomAsk([user(1), ask(2, 'Can you check this, @user?')], null)
	expect(a).toMatchObject({ key: 'ask:2', seq: 2, who: 'Scout', approval: false })
	expect(roomAsk([ask(2, '@user look'), user(3)], null)).toBeNull()
	expect(roomAsk([ask(2, 'mail the @username list')], null)).toBeNull()
})

test("a room's pending approval comes first and is keyed by its turn", () => {
	const a = roomAsk([ask(2, '@user hi')], {
		pending_actions: [{ kind: 'approval', task_id: 't1', execution_generation: 3, approval: { command: 'rm -rf x' } }],
	})
	expect(a).toEqual({ key: 'approval:t1:3', text: 'rm -rf x', approval: true })
})

test('a failed run is news when it is new', () => {
	const jobs = [{ id: 'j', name: 'Backup', last_run_at: '2026-11-14T10:00:00', last_status: 'ok' }]
	const first = failedRuns(undefined, jobs)
	expect(first.failed).toEqual([])
	const failed = [{ ...jobs[0]!, last_run_at: '2026-11-15T10:00:00', last_status: 'error' }]
	const second = failedRuns(first.seen, failed)
	expect(second.failed.map((j) => j.id)).toEqual(['j'])
	expect(failedRuns(second.seen, failed).failed).toEqual([])
	// A stop by hand is no failure; a delivery that failed is.
	expect(failedRuns(first.seen, [{ ...failed[0]!, last_status: 'cancelled' }]).failed).toEqual([])
	expect(failedRuns(first.seen, [{ ...failed[0]!, last_status: 'delivery_failed' }]).failed).toHaveLength(1)
})

test('routes and tags name the same chats', () => {
	expect(tagOfRoute(botNotice('ada').route)).toBe(botNotice('ada').tag)
	expect(tagOfRoute(chatNotice('s 1').route)).toBe(chatNotice('s 1').tag)
	expect(tagOfRoute(roomNotice('r1').route)).toBe(roomNotice('r1').tag)
	expect(tagOfRoute('/chat/bot/ada')).toBe('bot:ada')
	expect(tagOfRoute('/chat/room/r1')).toBe('room:r1')
	expect(tagOfRoute('/bots')).toBeNull()
	expect(tagOfRoute('/schedules')).toBeNull()
})

test('nobody hears of the chat they look at, and with quiet on nobody while one device is in use', () => {
	const active = [{ device: 'phone', viewing: 'bot:ada', at: 0 }]
	expect(audience({ tag: 'bot:ada' }, active, false).send).toBe(false)
	const other = audience({ tag: 'bot:max' }, active, false)
	expect(other.send).toBe(true)
	expect([...other.skipDevices]).toEqual(['phone'])
	expect(audience({ tag: 'bot:max' }, active, true).send).toBe(false)
	expect(audience({ tag: 'bot:max' }, [], true).send).toBe(true)
})

test('notification settings from outside are checked', () => {
	const ok = (v: unknown) => Value.Check(NotifyPatchSchema, v)
	expect(ok({ events: { reply: false } })).toBe(true)
	expect(ok({ events: { nope: true } })).toBe(false)
	expect(ok({ channels: [{ kind: 'ntfy', url: 'ftp://x' }] })).toBe(false)
	expect(ok({ channels: [{ kind: 'webhook', url: 'https://x.test/h' }] })).toBe(true)
	expect(ok({ channels: [{ kind: 'webhook', url: 'https://x.test/h', token: 't' }] })).toBe(false)
	expect(ok({ extra: 1 })).toBe(false)
})

test('a preview is plain and short', () => {
	expect(preview('**Done.** See [the log](http://x)\n\n```\ncode\n```\nbye')).toBe('Done. See the log bye')
	expect(preview('x'.repeat(300), 10)).toHaveLength(10)
})
