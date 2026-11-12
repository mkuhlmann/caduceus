import { ApiError, post, url } from './http'

/**
 * Hermes' JSON-RPC methods that only its own apps' socket offers (group chats, profile metadata, images), reached
 * through the relay: `rpc(method, params)` for one call, `onRpcEvent(type, fn)` for the change events Hermes
 * pushes. One event stream is shared by the whole app and closed when nobody listens.
 */
export async function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
	const r = await post<{ result: T }>('ui-api/rpc', { method, params })
	return r.result
}

type Listener = (payload: any) => void
const listeners = new Map<string, Set<Listener>>()
let source: EventSource | null = null

function ensureSource() {
	if (source) return
	source = new EventSource(url('ui-api/rpc/events'))
	for (const type of listeners.keys()) source.addEventListener(type, dispatch)
}

function dispatch(e: Event) {
	const msg = e as MessageEvent
	let payload: unknown = null
	try {
		payload = JSON.parse(msg.data)
	} catch {}
	for (const fn of listeners.get(msg.type) ?? []) fn(payload)
}

/** Listen to one Hermes event type (e.g. `groups.changed`); returns the unsubscribe. */
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
			source?.close()
			source = null
		}
	}
}

export { ApiError }
