import { describe, expect, test } from 'bun:test'
import { createSessionViews, type ViewSocket } from '../server/session-views'

/**
 * A Hermes socket as the session authority treats it: one subscription per chat for the whole socket (a second
 * resume answers with the one it has), and one detach ends it.
 */
class FakeHermes {
	subs = new Map<string, string>()
	calls: string[] = []
	private listeners = new Set<(e: { type: string; params?: Record<string, any> }) => void>()
	private n = 0

	socket: ViewSocket = {
		rpc: async <T>(method: string, params: Record<string, unknown>) => {
			const sid = String(params.session_id)
			this.calls.push(`${method} ${sid}`)
			await Promise.resolve()
			if (method === 'session.resume') {
				const sub = this.subs.get(sid) ?? `sub${++this.n}`
				this.subs.set(sid, sub)
				return { session_id: sid, subscription_id: sub, running: false } as T
			}
			if (method === 'session.detach' && this.subs.get(sid) === params.subscription_id) this.subs.delete(sid)
			return {} as T
		},
		onEvent: (fn) => {
			this.listeners.add(fn)
			return () => this.listeners.delete(fn)
		},
	}

	get listening() {
		return this.listeners.size
	}
	emit(type: string, params: Record<string, any> = {}) {
		for (const fn of [...this.listeners]) fn({ type, params })
	}
	/** Hermes retires a subscription whose events piled up, and says so on the socket. */
	overflow(sid: string) {
		this.subs.delete(sid)
		this.emit('session.replay_gap', { session_id: sid })
	}
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('session views', () => {
	test('two views of one chat share its subscription, and it ends with the last', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const phone = await views.view('default', 'c1')
		const desk = await views.view('default', 'c1')
		expect(desk.attached.subscription_id).toBe(phone.attached.subscription_id!)

		phone.release()
		await settle()
		// The desk still views the chat: Hermes still has a viewer that can answer its questions.
		expect(h.subs.has('c1')).toBe(true)
		expect(h.calls).not.toContain('session.detach c1')

		desk.release()
		await settle()
		expect(h.subs.has('c1')).toBe(false)
		expect(views.count('default', 'c1')).toBe(0)
	})

	test('releasing twice counts once', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const a = await views.view('default', 'c1')
		await views.view('default', 'c1')
		a.release()
		a.release()
		await settle()
		expect(h.subs.has('c1')).toBe(true)
		expect(views.count('default', 'c1')).toBe(1)
	})

	test('chats of different bots are counted apart', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const a = await views.view('remi', 'c1')
		await views.view('ami', 'c2')
		a.release()
		await settle()
		expect(h.subs.has('c1')).toBe(false)
		expect(h.subs.has('c2')).toBe(true)
	})

	test('a view starting while the last one ends keeps the chat viewed', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const a = await views.view('default', 'c1')
		a.release()
		const b = views.view('default', 'c1')
		await b
		await settle()
		expect(h.subs.has('c1')).toBe(true)
		expect(views.count('default', 'c1')).toBe(1)
	})

	test('a chat whose subscription Hermes retired is viewed again', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const a = await views.view('default', 'c1')
		h.overflow('c1')
		await settle()
		await settle()
		expect(h.subs.has('c1')).toBe(true)
		// The new subscription is the one let go of in the end.
		a.release()
		await settle()
		expect(h.subs.has('c1')).toBe(false)
	})

	test('views lost with the socket are not let go of on the next one', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		const old = await views.view('default', 'c1')
		h.emit('socket.closed')
		h.subs.clear()
		const fresh = await views.view('default', 'c1')
		old.release()
		await settle()
		expect(h.subs.get('c1')).toBe(fresh.attached.subscription_id!)
		expect(views.count('default', 'c1')).toBe(1)
	})

	test('listens to the socket only while a chat is viewed', async () => {
		const h = new FakeHermes()
		const views = createSessionViews(h.socket)
		expect(h.listening).toBe(0)
		const a = await views.view('default', 'c1')
		expect(h.listening).toBe(1)
		a.release()
		await settle()
		expect(h.listening).toBe(0)
	})
})
