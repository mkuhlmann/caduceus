import { Elysia } from 'elysia'
import { getConnection, onConnectionChange } from './config'
import { relay } from './relay'

/**
 * One JSON-RPC socket to Hermes (`/api/ws` on the dashboard), held by the relay. Everything Hermes exposes only
 * to its own apps goes through it: group chats (`groups.*`), profile metadata (`profiles.configure`), avatars and
 * generated images. The browser never sees the socket or its ticket; it calls `POST /ui-api/rpc` for an allowed
 * method and listens to `GET /ui-api/rpc/events` for the change events Hermes pushes.
 */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class RpcError extends Error {
	constructor(
		message: string,
		public code?: number | string,
		public data?: unknown,
	) {
		super(message)
	}
}

let ws: WebSocket | null = null
let ready: Promise<void> | null = null
let nextId = 0
const pending = new Map<number, Pending>()
/** One event Hermes pushed; `params` is the whole frame, with `session_id` and the turn's stamps when it has them. */
export type SocketEvent = { type: string; payload: any; params?: Record<string, any> }
const listeners = new Set<(event: SocketEvent) => void>()
/** Listeners inside the relay (session viewers); told with `socket.closed` when the socket goes away. */
const viewers = new Set<(event: SocketEvent) => void>()
// Hermes runs sessions through a session authority, the only mode in which a socket can view a live session.
let authority = false
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

onConnectionChange(() => close('connection changed'))

function close(reason: string) {
	clearTimeout(retryTimer)
	ready = null
	const old = ws
	ws = null
	old?.close()
	for (const [, p] of pending) {
		clearTimeout(p.timer)
		p.reject(new RpcError(`Hermes socket closed: ${reason}`, 'socket_closed'))
	}
	pending.clear()
	for (const fn of viewers) fn({ type: 'socket.closed', payload: { reason } })
}

/** A one-use ticket for the socket, minted with the relay's dashboard login. */
async function ticket(): Promise<string> {
	for (const path of ['/api/auth/ws-ticket', '/api/webapp/socket-ticket?socket=gateway']) {
		const res = await relay('dash', path.replace(/\?.*/, ''), new Request('http://relay' + path, { method: 'POST' }))
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as { ticket?: string } | null
			if (body?.ticket) return body.ticket
		}
	}
	throw new RpcError(
		'The Hermes dashboard did not issue a socket ticket. Check the dashboard login on the connection page.',
		'no_ticket',
	)
}

function connect(): Promise<void> {
	ready ??= (async () => {
		const base = getConnection().dashboardUrl
		if (!base) throw new RpcError('No dashboard URL configured.', 'not_configured')
		const t = await ticket()
		const socket = new WebSocket(base.replace(/^http/, 'ws') + '/api/ws', [
			'hermes-gateway-v1',
			`hermes-gateway-ticket.${t}`,
		])
		ws = socket
		await new Promise<void>((resolve, reject) => {
			const fail = () => reject(new RpcError('Could not open the Hermes socket.', 'socket_failed'))
			socket.onerror = fail
			socket.onclose = fail
			socket.onmessage = (e) => {
				const frame = parse(e.data)
				// Hermes greets every socket with gateway.ready before it answers calls.
				if (frame?.method === 'event' && frame.params?.type === 'gateway.ready') {
					authority = !!frame.params.payload?.session_authority
					resolve()
				} else handle(frame)
			}
		})
		retry = 0
		socket.onmessage = (e) => handle(parse(e.data))
		socket.onerror = () => {}
		socket.onclose = () => {
			if (ws !== socket) return
			close('closed by Hermes')
			// Keep listening for change events while someone watches; calls reconnect on demand anyway.
			if (listeners.size || viewers.size)
				retryTimer = setTimeout(() => connect().catch(() => {}), Math.min(30_000, 1000 * 2 ** retry++))
		}
	})().catch((e) => {
		ready = null
		ws = null
		if (listeners.size) retryTimer = setTimeout(() => connect().catch(() => {}), Math.min(30_000, 1000 * 2 ** retry++))
		throw e
	})
	return ready
}

function parse(data: unknown): any {
	try {
		return JSON.parse(String(data))
	} catch {
		return null
	}
}

function handle(frame: any) {
	if (!frame) return
	if (frame.id != null && pending.has(frame.id)) {
		const p = pending.get(frame.id)!
		pending.delete(frame.id)
		clearTimeout(p.timer)
		if (frame.error)
			p.reject(new RpcError(frame.error.message ?? 'Hermes refused the call.', frame.error.code, frame.error.data))
		else p.resolve(frame.result)
		return
	}
	if (frame.method === 'event' && frame.params?.type) {
		const event = { type: String(frame.params.type), payload: frame.params.payload ?? null, params: frame.params }
		for (const fn of listeners) fn(event)
		for (const fn of viewers) fn(event)
	}
	// Requests from Hermes (a sudo password, a secret, a question) go to every viewer of a session. Any answer,
	// even an error, would settle them for Hermes Desktop too, so they are left to the apps that show them.
}

/** Open the socket and say whether Hermes can show a live session to a viewer on it. */
export async function viewerSupport(): Promise<boolean> {
	await connect()
	return authority
}

/** Listen to every event on the socket, inside the relay; returns the unsubscribe. */
export function onSocketEvent(fn: (event: SocketEvent) => void): () => void {
	viewers.add(fn)
	return () => viewers.delete(fn)
}

/** Call a Hermes JSON-RPC method over the shared socket. */
export async function rpc<T = any>(
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 60_000,
): Promise<T> {
	await connect()
	const socket = ws
	if (!socket || socket.readyState !== WebSocket.OPEN) throw new RpcError('Hermes socket is not open.', 'socket_closed')
	const id = ++nextId
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id)
			reject(new RpcError(`Hermes did not answer ${method} in time.`, 'timeout'))
		}, timeoutMs)
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
		socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
	})
}

/** Methods the browser may call through the relay. Everything else stays server-side. */
const ALLOWED = new Set([
	'groups.capabilities',
	'groups.list',
	'groups.create',
	'groups.state',
	'groups.log',
	'groups.send',
	'groups.rename',
	'groups.context',
	'groups.disband',
	'groups.stop',
	'groups.continue',
	'groups.retry',
	'groups.discard',
	'groups.approve',
	'groups.attachment.upload',
	'groups.attachment.download',
	'profiles.list',
	'profiles.get_asset',
	'profiles.describe',
	'image.generate',
])

/** Events worth passing to the browser: things that tell an open view to re-read. */
const FORWARDED = /^(groups\.changed|profiles\.changed|sessions\.changed|image\.|pet\.)/

export const rpcRoutes = new Elysia({ prefix: '/ui-api/rpc' })
	.post('/', async ({ body, set }) => {
		const { method, params } = (body ?? {}) as { method?: string; params?: Record<string, unknown> }
		if (!method || !ALLOWED.has(method)) {
			set.status = 403
			return { error: { message: `Method ${method} is not available.`, code: 'not_allowed' } }
		}
		try {
			return { result: await rpc(method, params ?? {}, method === 'image.generate' ? 180_000 : 60_000) }
		} catch (e) {
			const err = e as RpcError
			set.status = err.code === 'no_ticket' || err.code === 'socket_failed' || err.code === 'socket_closed' ? 502 : 400
			return { error: { message: err.message, code: err.code, data: err.data } }
		}
	})
	.get('/events', ({ request }) => {
		const encoder = new TextEncoder()
		let send: ((event: { type: string; payload: unknown }) => void) | undefined
		let ping: ReturnType<typeof setInterval> | undefined
		const stream = new ReadableStream({
			start(controller) {
				send = (event) => {
					if (FORWARDED.test(event.type))
						controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`))
				}
				listeners.add(send)
				ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000)
				controller.enqueue(encoder.encode(': open\n\n'))
				connect().catch(() => {})
				request.signal.addEventListener('abort', () => {
					clearInterval(ping)
					if (send) listeners.delete(send)
					try {
						controller.close()
					} catch {}
				})
			},
			cancel() {
				clearInterval(ping)
				if (send) listeners.delete(send)
			},
		})
		return new Response(stream, {
			headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
		})
	})
