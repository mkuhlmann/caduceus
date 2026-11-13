import { url } from './http'
import { readSse } from './sse'

/** One event of a Bot Chat's turn, as Hermes sends it to a viewer. `generation` names the turn. */
export type WatchEvent = { type: string; payload: any; generation: number | null }

export type BotWatch = {
	/** The id Hermes uses for the chat in its events and approvals. */
	session: string
	/** A turn was already running when the watch began, and which one. */
	running: boolean
	generation: number | null
	/** Approvals and clarify questions waiting for an answer when the watch began, as Hermes sends them. */
	prompts: Array<Record<string, any>>
	close(): void
}

const READY_MS = 5000

/**
 * View a bot's Bot Chat live through the relay, as Hermes Desktop does. Resolves once the relay is attached, or
 * null when the connection cannot view a running chat (a standalone dashboard) or the attach failed. `onEnd` is
 * told when the view ends without `close()`: the relay lost Hermes' socket.
 */
export async function watchBotChat(
	profile: string,
	sessionId: string,
	onEvent: (e: WatchEvent) => void,
	onEnd?: () => void,
): Promise<BotWatch | null> {
	const abort = new AbortController()
	const timer = setTimeout(() => abort.abort(), READY_MS)
	try {
		const res = await fetch(
			url(`ui-api/bots/${encodeURIComponent(profile)}/watch?session=${encodeURIComponent(sessionId)}`),
			{ headers: { Accept: 'text/event-stream' }, signal: abort.signal },
		)
		if (!res.ok) return null
		const frames = readSse(res, abort.signal)
		const first = await frames.next()
		if (first.done || first.value.event !== 'ready') return null
		clearTimeout(timer)
		const ready = JSON.parse(first.value.data)
		void (async () => {
			try {
				for await (const f of frames) {
					if (f.event === 'ping' || !f.event) continue
					const d = JSON.parse(f.data)
					onEvent({ type: f.event, payload: d.payload ?? d, generation: d.generation ?? null })
				}
			} catch {
				// Closed: a turn sent from here still ends with the chat's own stream.
			}
			if (!abort.signal.aborted) onEnd?.()
		})()
		return {
			session: ready.session,
			running: !!ready.running,
			generation: ready.generation ?? null,
			prompts: Array.isArray(ready.prompts) ? ready.prompts : [],
			close: () => abort.abort(),
		}
	} catch {
		abort.abort()
		return null
	} finally {
		clearTimeout(timer)
	}
}
