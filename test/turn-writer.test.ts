import { beforeAll, describe, expect, test } from 'bun:test'
import type { ChatEvent } from '@/lib/gateway'
import type { AgentTurn } from '@/lib/turns'
import { TurnWriter } from '@/lib/turn-writer'
import type { WatchEvent } from '@/lib/bot-watch'

beforeAll(() => {
	// Text is written once per frame; the tests flush instead.
	globalThis.requestAnimationFrame ??= () => 0
	globalThis.cancelAnimationFrame ??= () => {}
})

const fresh = (): AgentTurn => ({ kind: 'agent', key: 'live-agent', steps: [], reasoning: '', live: true })
const route = (t: AgentTurn) =>
	t.steps.map((s) =>
		s.kind === 'text'
			? `text: ${s.text}`
			: s.kind === 'tool'
				? `${s.name} ${s.status}`
				: s.kind === 'approval'
					? `approval ${s.resolved ?? 'open'}`
					: `clarify ${s.answer ?? 'open'}`,
	)

describe('the chat stream of a turn sent from here', () => {
	test('text, a tool and more text land in order', () => {
		const w = new TurnWriter(fresh())
		const events: ChatEvent[] = [
			{ type: 'run.started', run_id: 'r1', session_id: 's1' },
			{ type: 'assistant.delta', delta: 'Let me ' },
			{ type: 'assistant.delta', delta: 'look.' },
			{ type: 'tool.started', tool: 'terminal', args: { command: 'ls' } },
			{ type: 'reasoning', delta: 'listing' },
			{ type: 'tool.completed', tool: 'terminal', failed: false },
			{ type: 'assistant.delta', delta: 'Done.' },
			{ type: 'run.finished', status: 'completed' },
		]
		for (const ev of events) w.applyChat(ev)
		expect(route(w.turn)).toEqual(['text: Let me look.', 'terminal done', 'text: Done.'])
		expect(w.turn.reasoning).toBe('listing')
		expect(w.turn.error).toBeUndefined()
	})

	test('an approval records the run it is answered through', () => {
		const w = new TurnWriter(fresh())
		const request = { run_id: 'r1', request_id: 'p1', command: 'rm -rf build' }
		w.applyChat({ type: 'approval.request', request })
		expect(w.turn.steps).toEqual([
			{
				kind: 'approval',
				command: 'rm -rf build',
				description: undefined,
				choices: ['once', 'session', 'always', 'deny'],
				via: { run: request },
			},
		])
	})

	test('a failed run says why', () => {
		const w = new TurnWriter(fresh())
		expect(w.applyChat({ type: 'run.finished', status: 'failed', error: 'Out of credits' })).toEqual({ complete: true })
		expect(w.turn.error).toBe('Out of credits')
		w.applyChat({ type: 'error', message: 'Stream closed' })
		expect(w.turn.error).toBe('Stream closed')
	})

	test('status lines are for whoever shows the turn', () => {
		expect(new TurnWriter(fresh()).applyChat({ type: 'status', text: 'Compacting' })).toEqual({ status: 'Compacting' })
	})

	test('restart drops what was read from saved steps', () => {
		const w = new TurnWriter(fresh())
		w.turn.steps = [{ kind: 'tool', name: 'terminal', status: 'running' }]
		w.turn.reasoning = 'saved'
		w.restart()
		w.applyChat({ type: 'assistant.delta', delta: 'hi' })
		w.flush()
		expect(route(w.turn)).toEqual(['text: hi'])
		expect(w.turn.reasoning).toBe('')
	})
})

describe('the Hermes socket a Bot Chat is watched on', () => {
	const where = { profile: 'scout', session: 'hs1' }
	const ev = (type: string, payload: Record<string, unknown> = {}, generation: number | null = 3): WatchEvent => ({
		type,
		payload,
		generation,
	})

	test('an approval records the socket prompt, once however often it is reported', () => {
		const w = new TurnWriter(fresh())
		w.apply(ev('approval.request', { prompt_id: 'p1', command: 'deploy' }), where)
		w.apply(ev('approval.request', { prompt_id: 'p1', command: 'deploy' }), where)
		expect(w.turn.steps).toHaveLength(1)
		expect(w.turn.steps[0]).toMatchObject({
			kind: 'approval',
			via: { profile: 'scout', session: 'hs1', generation: 3, id: 'p1' },
		})
	})

	test('an approval decided elsewhere can no longer be decided here', () => {
		const w = new TurnWriter(fresh())
		w.apply(ev('approval.request', { prompt_id: 'p1' }), where)
		w.apply(ev('approval.request', { prompt_id: 'p2' }), where)
		w.apply(ev('approval.settled', { prompt_id: 'p1' }), where)
		expect(route(w.turn)).toEqual(['approval elsewhere', 'approval open'])
	})

	test('clarify questions are asked once and settle', () => {
		const w = new TurnWriter(fresh())
		const q = { prompt_id: 'q1', question: 'Which branch?', choices: ['main', 'dev'] }
		w.apply(ev('clarify.request', q), where)
		w.apply(ev('clarify.request', q), where)
		w.apply(ev('clarify.settled', { prompt_id: 'q1' }), where)
		expect(route(w.turn)).toEqual(['clarify elsewhere'])
	})

	test('tools match by id, and the turn reports its end or a gap', () => {
		const w = new TurnWriter(fresh())
		w.apply(ev('tool.start', { tool_id: 't1', name: 'browser' }))
		w.apply(ev('tool.start', { tool_id: 't2', name: 'browser' }))
		w.apply(ev('tool.complete', { tool_id: 't1', is_error: true, result_text: 'boom' }))
		expect(route(w.turn)).toEqual(['browser failed', 'browser running'])
		expect(w.apply(ev('session.replay_gap'))).toEqual({ gap: true })
		expect(w.apply(ev('message.complete', { status: 'error', error: 'Stopped' }))).toEqual({ complete: true })
		expect(w.turn.error).toBe('Stopped')
	})
})
