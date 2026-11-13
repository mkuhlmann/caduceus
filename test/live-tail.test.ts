import { describe, expect, test } from 'bun:test'
import type { Message } from '@/lib/gateway'
import type { AgentTurn, Turn } from '@/lib/turns'
import { lastReplyKey, liveTurns, newestId, savedProgress, startId, turnStartHeld } from '@/lib/live-tail'

const user = (id: number, text: string): Message => ({ id, role: 'user', content: text })
const reply = (id: number, text: string): Message => ({ id, role: 'assistant', content: text })
const call = (id: number, callId: string, name = 'terminal'): Message => ({
	id,
	role: 'assistant',
	content: '',
	tool_calls: [{ id: callId, function: { name, arguments: '{}' } }],
})
const result = (id: number, callId: string): Message => ({ id, role: 'tool', content: 'ok', tool_call_id: callId })

const running = (): AgentTurn => ({ kind: 'agent', key: 'live-agent', steps: [], reasoning: '', live: true })
// What a reader sees: who speaks, and what.
const shown = (ts: Turn[]) =>
	ts.map((t) => (t.kind === 'user' ? `user: ${t.text}` : `agent${t.live ? ' (live)' : ''}: ${t.steps.length} steps`))

const earlier = [user(1, 'hi'), reply(2, 'hello')]

describe('a turn sent from here', () => {
	test('the message shows once after Hermes saved it and the first steps', () => {
		// Sent while messages 1–2 were held; reading the chat again brings the message and a step of the turn.
		const ms = [...earlier, user(3, 'list files'), call(4, 'c1')]
		const turns = liveTurns(ms, { kind: 'sent', turn: running(), user: { text: 'list files', images: [] }, after: 2 })
		expect(shown(turns)).toEqual(['user: hi', 'agent: 1 steps', 'user: list files', 'agent (live): 0 steps'])
		expect(turns[2]!.key).toBe('live-user')
	})

	test('sent before the chat had loaded, the saved copy of the message is cut by its text', () => {
		const ms = [...earlier, user(3, 'list files'), call(4, 'c1')]
		const turns = liveTurns(ms, { kind: 'sent', turn: running(), user: { text: 'list files ', images: [] } })
		expect(shown(turns)).toEqual(['user: hi', 'agent: 1 steps', 'user: list files ', 'agent (live): 0 steps'])
	})

	test('sent before the chat had loaded, and not saved yet: the whole transcript shows above it', () => {
		const turns = liveTurns(earlier, { kind: 'sent', turn: running(), user: { text: 'list files', images: [] } })
		expect(shown(turns)).toEqual(['user: hi', 'agent: 1 steps', 'user: list files', 'agent (live): 0 steps'])
	})

	test('the only message so far', () => {
		const turns = liveTurns([user(1, 'hi')], { kind: 'sent', turn: running(), user: { text: 'hi', images: [] } })
		expect(shown(turns)).toEqual(['user: hi', 'agent (live): 0 steps'])
	})
})

describe('a turn watched on the Hermes socket', () => {
	test('a message from another device saved after the turn began shows above the turn', () => {
		const turn = running()
		// The turn began when message 2 was the newest; Hermes then saved the message that began it, and a step.
		const ms = [...earlier, user(3, 'from my phone'), call(4, 'c1')]
		expect(shown(liveTurns(ms, { kind: 'watched', turn, after: 2 }))).toEqual([
			'user: hi',
			'agent: 1 steps',
			'user: from my phone',
			'agent (live): 0 steps',
		])
	})

	test('before the cut is known the transcript shows whole', () => {
		const turns = liveTurns(earlier, { kind: 'watched', turn: running() })
		expect(shown(turns)).toEqual(['user: hi', 'agent: 1 steps', 'agent (live): 0 steps'])
	})

	test('its start is held once the message that began it is', () => {
		expect(turnStartHeld([...earlier, user(3, 'go')], 3)).toBe(true)
		expect(turnStartHeld(earlier, 2)).toBe(false)
		expect(turnStartHeld([...earlier, user(3, 'go')], 2)).toBe(true)
		expect(turnStartHeld([...earlier, reply(3, 'routine says hi')], 2)).toBe(false)
		expect(turnStartHeld([], undefined)).toBe(false)
		expect(turnStartHeld([user(1, 'go')], undefined)).toBe(true)
	})
})

describe('a turn followed while it runs elsewhere', () => {
	test('what it waits for joins the last saved reply, which stays as it was', () => {
		const ms = [...earlier, user(3, 'deploy'), call(4, 'c1')]
		const approval = { kind: 'approval' as const, command: 'rm -rf build', choices: ['once', 'deny'] }
		const turns = liveTurns(ms, { kind: 'followed', waiting: [approval] })
		expect(shown(turns)).toEqual(['user: hi', 'agent: 1 steps', 'user: deploy', 'agent (live): 2 steps'])
		// The saved turns are cached per transcript: they must not pick up the live step.
		expect(shown(liveTurns(ms, undefined)).at(-1)).toBe('agent: 1 steps')
	})

	test('with nothing saved of it yet, a turn of its own', () => {
		const turns = liveTurns([...earlier, user(3, 'deploy')], { kind: 'followed', waiting: [] })
		expect(turns.at(-1)).toMatchObject({ kind: 'agent', key: 'remote-agent', live: true })
	})
})

test('a page that starts in the middle of a reply hides it until its start is loaded', () => {
	const ms = [reply(2, 'hello'), user(3, 'more'), reply(4, 'sure')]
	expect(shown(liveTurns(ms, undefined, { older: true }))).toEqual(['user: more', 'agent: 1 steps'])
	expect(shown(liveTurns(ms, undefined))).toHaveLength(3)
})

test('anchors', () => {
	const ms = [...earlier, user(3, 'go'), call(4, 'c1')]
	expect(newestId(ms)).toBe(4)
	expect(newestId([])).toBeUndefined()
	expect(startId(ms)).toBe(3)
	expect(startId([reply(1, 'routine')])).toBeUndefined()
	expect(lastReplyKey(ms)).toBe('a4')
	expect(lastReplyKey([user(1, 'hi')])).toBeUndefined()
})

test('saved progress: the work after the cut, calls without results still running', () => {
	const ms = [...earlier, user(3, 'go'), call(4, 'c1'), result(5, 'c1'), call(6, 'c2', 'browser')]
	const p = savedProgress(ms, 3)!
	expect(p.steps.map((s) => (s.kind === 'tool' ? `${s.name} ${s.status}` : s.kind))).toEqual([
		'terminal done',
		'browser running',
	])
	expect(savedProgress(ms, 6)).toBeNull()
})
