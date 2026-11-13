import { describe, expect, test } from 'bun:test'
import { watchBotChat, type WatchEvent, type WatchSource } from '@/lib/bot-watch'

/** A relay view whose events the test sends, and ends. */
class FakeView {
	private queue: WatchEvent[] = []
	private wake?: () => void
	private ended = false

	constructor(
		readonly ready = { session: 'hs1', running: false, generation: null as number | null, prompts: [] as any[] },
	) {}

	send(type: string, generation: number | null, payload: Record<string, unknown> = {}) {
		this.queue.push({ type, generation, payload })
		this.wake?.()
	}
	end() {
		this.ended = true
		this.wake?.()
	}
	async *events(): AsyncGenerator<WatchEvent> {
		while (true) {
			while (this.queue.length) yield this.queue.shift()!
			if (this.ended) return
			await new Promise<void>((r) => (this.wake = r))
		}
	}
}

const sourceOf =
	(...views: FakeView[]): WatchSource =>
	async () => {
		const v = views.shift()
		return v ? { ready: v.ready, events: v.events() } : null
	}
const tick = () => new Promise((r) => setTimeout(r, 0))

/** Records the turns the watch reports as started elsewhere, and their events. */
function recorder() {
	const log: string[] = []
	return {
		log,
		onTurn: (generation: number | null, midway: boolean) => {
			log.push(`start ${generation}${midway ? ' midway' : ''}`)
			return {
				event: (ev: WatchEvent) => log.push(`${generation}: ${ev.type}`),
				end: () => log.push(`end ${generation}`),
			}
		},
	}
}

describe('turns started elsewhere', () => {
	test('each generation is its own turn; a new one ends the last', async () => {
		const view = new FakeView()
		const r = recorder()
		const w = await watchBotChat('scout', 's1', { onTurn: r.onTurn }, sourceOf(view))
		view.send('message.delta', 1)
		view.send('message.delta', 2)
		view.send('message.delta', 1) // late, of a turn that ended: starts nothing
		await tick()
		expect(r.log).toEqual(['start 1', '1: message.delta', 'end 1', 'start 2', '2: message.delta'])
		w!.close()
	})

	test('a turn ends with its last message, or when Hermes drops the view', async () => {
		const view = new FakeView()
		const r = recorder()
		await watchBotChat('scout', 's1', { onTurn: r.onTurn }, sourceOf(view))
		view.send('message.complete', 1)
		view.send('session.replay_gap', 2)
		await tick()
		expect(r.log).toEqual(['start 1', '1: message.complete', 'end 1', 'start 2', '2: session.replay_gap', 'end 2'])
	})

	test('joined midway, with what it still waits for', async () => {
		const view = new FakeView({
			session: 'hs1',
			running: true,
			generation: 4,
			prompts: [{ kind: 'approval', prompt_id: 'p1' }, { kind: 'other' }],
		})
		const r = recorder()
		await watchBotChat('scout', 's1', { onTurn: r.onTurn }, sourceOf(view))
		expect(r.log).toEqual(['start 4 midway', '4: approval.request'])
	})
})

describe('a turn sent from here', () => {
	test('claims the next turn; one running already keeps its own place', async () => {
		const view = new FakeView({ session: 'hs1', running: true, generation: 1, prompts: [] })
		const r = recorder()
		const w = (await watchBotChat('scout', 's1', { onTurn: r.onTurn }, sourceOf(view)))!
		const mine: string[] = []
		const release = w.claim((ev) => mine.push(`${ev.generation}: ${ev.type}`))
		view.send('message.delta', 1)
		view.send('message.delta', 2)
		view.send('message.complete', 1)
		view.send('message.complete', 2)
		await tick()
		release()
		view.send('message.delta', 2) // late: the claimed turn ended
		view.send('message.delta', 3)
		await tick()
		expect(mine).toEqual(['2: message.delta', '2: message.complete'])
		expect(r.log).toEqual([
			'start 1 midway',
			'1: message.delta',
			'1: message.complete',
			'end 1',
			'start 3',
			'3: message.delta',
		])
	})

	test('released when its stream was lost, its later events show as a turn started elsewhere', async () => {
		const view = new FakeView()
		const r = recorder()
		const w = (await watchBotChat('scout', 's1', { onTurn: r.onTurn }, sourceOf(view)))!
		const release = w.claim(() => {})
		view.send('message.delta', 5)
		await tick()
		release(true)
		view.send('message.delta', 5)
		await tick()
		expect(r.log).toEqual(['start 5', '5: message.delta'])
	})
})

describe('the relay losing the socket', () => {
	test('ends the turn shown, attaches again and keeps the claim', async () => {
		const first = new FakeView()
		const second = new FakeView({ session: 'hs1', running: true, generation: 7, prompts: [{ kind: 'clarify' }] })
		const r = recorder()
		const w = (await watchBotChat('scout', 's1', { onTurn: r.onTurn, reattach: true }, sourceOf(first, second)))!
		first.send('message.delta', 6)
		await tick()
		const mine: string[] = []
		w.claim((ev) => mine.push(`${ev.generation}: ${ev.type}`))
		first.end()
		await new Promise((done) => setTimeout(done, 2100))
		second.send('message.delta', 7)
		await tick()
		expect(r.log).toEqual(['start 6', '6: message.delta', 'end 6'])
		// The claim skips generation 6, running when it was made: the turn running at the new attach is the claimed one.
		expect(mine).toEqual(['7: clarify.request', '7: message.delta'])
		w.close()
	})

	test('a turn still running at the new attach shows again, with what it waits for', async () => {
		const first = new FakeView()
		const second = new FakeView({
			session: 'hs1',
			running: true,
			generation: 6,
			prompts: [{ kind: 'approval', prompt_id: 'p1' }],
		})
		const r = recorder()
		const w = (await watchBotChat('scout', 's1', { onTurn: r.onTurn, reattach: true }, sourceOf(first, second)))!
		first.send('message.delta', 6)
		await tick()
		first.end()
		await tick()
		expect(w.connected).toBe(false)
		await new Promise((done) => setTimeout(done, 2100))
		expect(w.connected).toBe(true)
		second.send('message.delta', 6)
		await tick()
		expect(r.log).toEqual([
			'start 6',
			'6: message.delta',
			'end 6',
			'start 6 midway',
			'6: approval.request',
			'6: message.delta',
		])
		w.close()
	})

	test('cannot view the chat at all', async () => {
		expect(await watchBotChat('scout', 's1', {}, sourceOf())).toBeNull()
	})
})
