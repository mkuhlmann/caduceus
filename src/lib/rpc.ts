import { ApiError, post, url } from './http'

/**
 * Hermes' JSON-RPC methods that only its own apps' socket offers (group chats, profile metadata, images), reached
 * through the relay: `rpc(method, params)` for one call, `onRpcEvent(type, fn)` for the change events the relay
 * passes on (Hermes' own, plus `bots.changed` and `caduceus.*` from the relay). One event stream is shared by the
 * whole app and closed when nobody listens.
 */
export async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
	const r = await post<{ result: T }>('ui-api/rpc', { method, params })
	return r.result
}

type Listener = (payload: any) => void
const listeners = new Map<string, Set<Listener>>()
const reconnected = new Set<() => void>()
let source: EventSource | null = null
let opened = false
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

function ensureSource() {
	if (source || !listeners.size) return
	clearTimeout(retryTimer)
	const s = new EventSource(url('ui-api/rpc/events'))
	source = s
	for (const type of listeners.keys()) s.addEventListener(type, dispatch)
	s.onopen = () => {
		retry = 0
		// Events sent while the stream was down are gone: whoever holds data reads it again.
		if (opened) for (const fn of reconnected) fn()
		opened = true
	}
	s.onerror = () => {
		// The browser retries a dropped stream by itself; one the relay refused (a restart, a lost login) it gives up.
		if (s.readyState !== EventSource.CLOSED || source !== s) return
		source = null
		retryTimer = setTimeout(ensureSource, Math.min(60_000, 2000 * 2 ** retry++))
	}
}

function dispatch(e: Event) {
	const msg = e as MessageEvent
	let payload: unknown = null
	try {
		payload = JSON.parse(msg.data)
	} catch {}
	for (const fn of listeners.get(msg.type) ?? []) fn(payload)
}

/** Listen to one change event (e.g. `groups.changed`); returns the unsubscribe. */
export function onRpcEvent(type: string, fn: Listener): () => void {
	let set = listeners.get(type)
	if (!set) {
		listeners.set(type, (set = new Set()))
		source?.addEventListener(type, dispatch)
	}
	set.add(fn)
	ensureSource()
	return () => {
		set!.delete(fn)
		if (!set!.size) {
			listeners.delete(type)
			source?.removeEventListener(type, dispatch)
		}
		if (!listeners.size) {
			clearTimeout(retryTimer)
			source?.close()
			source = null
			opened = false
		}
	}
}

/** Told each time the event stream comes back after it was down. */
export function onEventsReconnected(fn: () => void): () => void {
	reconnected.add(fn)
	return () => reconnected.delete(fn)
}

/**
 * Open the event stream afresh. After a phone slept, the old one can look open while nothing arrives on it any more.
 * The new one's opening is not a reconnect: whoever asks for this reads its data anyway.
 */
export function reopenEvents() {
	if (!listeners.size) return
	source?.close()
	source = null
	opened = false
	ensureSource()
}

export { ApiError }
