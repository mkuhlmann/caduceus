import { Elysia } from 'elysia'
import { onSocketEvent, rpc, RpcError, viewerSupport, views, type SocketEvent } from './hermes-socket'
import type { View } from './session-views'
import { relay } from './relay'
import { onChatStream } from './runs'
import { config } from './store'
import { BOT_CHAT } from '../src/lib/notifications'

/**
 * A bot's Bot Chat runs in the bot's own queue inside the gateway, and its chat stream reports nothing until the
 * reply is done. A socket the gateway serves (the Webapp's, with `session_authority`) can view that chat as Hermes
 * Desktop does: this attaches the relay's socket as a viewer of one chat and passes its turn to the browser, and
 * answers the approvals and clarify questions the turn asks for.
 *
 * `GET /ui-api/bots/:name/watch?session=<id>` streams `ready` (what is running and pending at attach), then the
 * turn's events. A dashboard that cannot view a session answers 409 `no_viewer`, and the browser falls back to
 * reading the steps Hermes saves.
 */

/** Events of a turn, as Hermes names them on the socket. */
const TURN = new Set([
	'message.start',
	'message.delta',
	'message.interim',
	'message.complete',
	'reasoning.delta',
	'reasoning.available',
	'tool.start',
	'tool.complete',
	'status.update',
	'approval.request',
	'approval.settled',
	'clarify.request',
	'clarify.settled',
	'session.replay_gap',
])

// Hermes' own profile is the gateway's launch profile: it is addressed by naming none.
const scope = (name: string) => (name === 'default' ? {} : { profile: name })

/**
 * Hermes asks a Bot Chat's question only while a viewer that can answer it is attached; with none, it skips the
 * question at once and the bot carries on without an answer. With `waitForAnswers` on, the relay views the chat itself
 * while a turn sent from Caduceus runs, so the question waits until you open the chat on any device and answer it
 * (a "waiting" notice tells you, when notifications are on). Its view counts like a browser's (`session-views.ts`).
 */
const held = new Map<string, Promise<View | null>[]>()
const botChats = new Map<string, boolean>()

async function isBotChat(profile: string, sessionId: string) {
	const known = botChats.get(sessionId)
	if (known !== undefined) return known
	const path = `${profile === 'default' ? '' : `/p/${encodeURIComponent(profile)}`}/api/sessions/${encodeURIComponent(sessionId)}`
	const res = await relay('gw', path, new Request('http://relay' + path))
	if (!res.ok) {
		await res.body?.cancel()
		return false
	}
	const r = (await res.json()) as { session?: { title?: string | null }; title?: string | null }
	const yes = (r.session ?? r).title === BOT_CHAT
	botChats.set(sessionId, yes)
	return yes
}

async function holdBotChat(profile: string, sessionId: string): Promise<View | null> {
	if (!(await viewerSupport()) || !(await isBotChat(profile, sessionId))) return null
	return views.view(profile, sessionId)
}

onChatStream((news) => {
	const key = `${news.profile}\0${news.sessionId}`
	if (news.type === 'started') {
		if (!config.preferences.waitForAnswers) return
		held.set(key, [...(held.get(key) ?? []), holdBotChat(news.profile, news.sessionId).catch(() => null)])
	} else if (news.type === 'finished') {
		const list = held.get(key)
		const first = list?.shift()
		if (list && !list.length) held.delete(key)
		void first?.then((v) => v?.release())
	}
})

export const botWatchRoutes = new Elysia({ prefix: '/ui-api/bots' })
	.get('/:name/watch', async ({ params, query, request, set }) => {
		const sessionId = String(query.session ?? '')
		if (!sessionId) {
			set.status = 400
			return { error: { message: 'Which chat should be watched?', code: 'invalid_params' } }
		}
		try {
			if (!(await viewerSupport())) {
				set.status = 409
				return {
					error: {
						message: 'This dashboard cannot show a running chat. Connect Caduceus to the Webapp the gateway serves.',
						code: 'no_viewer',
					},
				}
			}
		} catch (e) {
			set.status = 502
			return { error: { message: (e as Error).message, code: (e as RpcError).code } }
		}

		const encoder = new TextEncoder()
		let ended = false
		let off: (() => void) | undefined
		let ping: ReturnType<typeof setInterval> | undefined
		let view: View | undefined
		// Set once the view is attached: events of the chat are told apart by it.
		let session: string | undefined

		const detach = () => {
			if (ended) return
			ended = true
			clearInterval(ping)
			off?.()
			view?.release()
		}

		const stream = new ReadableStream({
			async start(controller) {
				const send = (event: string, data: unknown) => {
					if (ended) return
					try {
						controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
					} catch {
						detach()
					}
				}
				const finish = () => {
					detach()
					try {
						controller.close()
					} catch {}
				}
				request.signal.addEventListener('abort', finish)
				// Listen before attaching, so no frame between the attach and its answer is lost.
				const early: SocketEvent[] = []
				const forward = (e: SocketEvent) => {
					const p = e.params ?? {}
					send(e.type, {
						payload: e.payload,
						generation: typeof p.execution_generation === 'number' ? p.execution_generation : null,
					})
				}
				off = onSocketEvent((e) => {
					if (e.type === 'socket.closed') return finish()
					if (!TURN.has(e.type)) return
					const sid = e.params?.session_id
					if (!session) {
						if (sid === sessionId || sid?.startsWith?.('local-')) early.push(e)
						return
					}
					if (sid === session) forward(e)
				})
				try {
					const v = await views.view(params.name, sessionId)
					// The browser went away while the view attached.
					if (ended) return v.release()
					view = v
					const attached = v.attached
					if (!attached.session_id) throw new RpcError('Hermes did not open the chat.', 'no_session')
					session = attached.session_id
					// Reasoning goes to viewers only when the chat shows it, which a Bot Chat does not by default.
					rpc('config.set', {
						...scope(params.name),
						session_id: attached.session_id,
						key: 'show_reasoning',
						value: 'on',
					}).catch(() => {})
					send('ready', {
						session: attached.session_id,
						running: !!attached.running,
						generation: attached.execution_generation ?? null,
						prompts: attached.prompts ?? [],
					})
					for (const e of early) if (e.params?.session_id === attached.session_id) forward(e)
					ping = setInterval(() => send('ping', {}), 25_000)
				} catch (e) {
					send('failed', { message: (e as Error).message, code: (e as RpcError).code ?? null })
					finish()
				}
			},
			cancel() {
				detach()
			},
		})
		return new Response(stream, {
			headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
		})
	})
	.post('/:name/approval', async ({ params, body, set }) => {
		const b = (body ?? {}) as { session?: string; generation?: number; prompt?: string; choice?: string }
		if (!b.session || typeof b.generation !== 'number' || !b.prompt || !b.choice) {
			set.status = 400
			return { error: { message: 'The decision is missing its chat, turn or choice.', code: 'invalid_params' } }
		}
		try {
			return await rpc('approval.respond', {
				...scope(params.name),
				session_id: b.session,
				execution_generation: b.generation,
				prompt_id: b.prompt,
				choice: b.choice,
			})
		} catch (e) {
			const err = e as RpcError
			set.status = err.code === 'socket_closed' || err.code === 'socket_failed' ? 502 : 409
			return { error: { message: err.message, code: err.code } }
		}
	})
	.post('/:name/clarify', async ({ params, body, set }) => {
		const b = (body ?? {}) as { session?: string; generation?: number; prompt?: string; answer?: string }
		if (!b.session || typeof b.generation !== 'number' || !b.prompt || typeof b.answer !== 'string') {
			set.status = 400
			return { error: { message: 'The answer is missing its chat, turn or question.', code: 'invalid_params' } }
		}
		try {
			return await rpc('clarify.respond', {
				...scope(params.name),
				session_id: b.session,
				execution_generation: b.generation,
				prompt_id: b.prompt,
				answer: b.answer,
			})
		} catch (e) {
			const err = e as RpcError
			set.status = err.code === 'socket_closed' || err.code === 'socket_failed' ? 502 : 409
			return { error: { message: err.message, code: err.code } }
		}
	})
