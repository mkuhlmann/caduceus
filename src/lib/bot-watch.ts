import { url } from './http'
import { readSse } from './sse'

/** One event of a Bot Chat's turn, as Hermes sends it to a viewer. `generation` names the turn. */
export type WatchEvent = { type: string; payload: any; generation: number | null }

/** A turn of the chat that started elsewhere: its events arrive here until it ends. */
export type TurnFeed = { event(ev: WatchEvent): void; end(): void }

export type BotChatWatch = {
	/** The id Hermes uses for the chat in its events and approvals. */
	readonly session: string
	/** Events arrive now; false while the watch attaches again after the relay lost Hermes' socket. */
	readonly connected: boolean
	/**
	 * Take the events of the turn being sent from here. A turn already running keeps its own feed (this message
	 * waits behind it); the next one goes to `feed` until released. Release with `goesOn` when the turn continues
	 * without its sender (the stream was lost): its later events then show as a turn started elsewhere.
	 */
	claim(feed: (ev: WatchEvent) => void): (goesOn?: boolean) => void
	close(): void
}

export type WatchOptions = {
	/**
	 * A turn not claimed here began, or was running when the watch attached (`midway`; its waiting approvals and
	 * questions follow as events). `session` names the chat on the socket, where its prompts are answered. Return
	 * where its events go, or nothing to let it pass unseen.
	 */
	onTurn?: (generation: number | null, midway: boolean, session: string) => TurnFeed | undefined
	/** Attach again whenever the relay loses Hermes' socket, until closed. */
	reattach?: boolean
}

/** What the relay says as a view begins, then the chat's events. */
export type WatchSource = (
	profile: string,
	sessionId: string,
	signal: AbortSignal,
) => Promise<{ ready: Ready; events: AsyncIterable<WatchEvent> } | null>
type Ready = { session: string; running: boolean; generation: number | null; prompts: Array<Record<string, any>> }

const READY_MS = 5000
const RETRY_MS = [2000, 4000, 8000, 15_000, 30_000]

/**
 * View a bot's Bot Chat live through the relay, as Hermes Desktop does, and tell its turns apart. Resolves once
 * the relay is attached, or null when the connection cannot view a running chat (a standalone dashboard) or the
 * attach failed.
 *
 *   const watch = await watchBotChat(profile, id, { onTurn: (gen) => feedFor(gen), reattach: true })
 *   const release = watch?.claim((ev) => writer.apply(ev))   // the turn sent from here
 */
export async function watchBotChat(
	profile: string,
	sessionId: string,
	opts: WatchOptions = {},
	source: WatchSource = relay,
): Promise<BotChatWatch | null> {
	let abort = new AbortController()
	const first = await source(profile, sessionId, abort.signal).catch(() => null)
	if (!first) {
		abort.abort()
		return null
	}
	let session = first.ready.session
	let connected = true
	let closed = false
	let retry: ReturnType<typeof setTimeout> | undefined
	// Turns that ended: their late events start nothing.
	const done = new Set<number>()
	let current: { generation: number | null; feed?: TurnFeed } | null = null
	let claimed: { skip: number | null; feed: (ev: WatchEvent) => void; generation?: number } | null = null

	// `finished`: the turn ended, so its late events start nothing. A turn whose view dropped may still run, and
	// shows again when the watch attaches.
	const endCurrent = (finished = true) => {
		const c = current
		current = null
		if (!c) return
		if (finished && c.generation !== null) done.add(c.generation)
		c.feed?.end()
	}
	const isClaimed = (generation: number | null) => !!claimed && (claimed.skip === null || generation !== claimed.skip)

	const onEvent = (ev: WatchEvent) => {
		if (closed) return
		if (claimed && isClaimed(ev.generation)) {
			if (ev.generation !== null) claimed.generation = ev.generation
			return claimed.feed(ev)
		}
		if (ev.generation !== null && done.has(ev.generation)) return
		if (!current || (ev.generation !== null && current.generation !== null && ev.generation !== current.generation)) {
			endCurrent()
			current = { generation: ev.generation, feed: opts.onTurn?.(ev.generation, false, session) }
		}
		current.feed?.event(ev)
		// The turn ended, or the view fell behind and Hermes dropped it: whoever shows it reads what was saved.
		if (ev.type === 'message.complete' || ev.type === 'session.replay_gap') endCurrent()
	}

	// A turn running as the view begins, with what it already asked and still waits for.
	const attached = (ready: Ready) => {
		session = ready.session
		if (!ready.running) return
		const asked = ready.prompts
			.filter((p) => p.kind === 'approval' || p.kind === 'clarify')
			.map((p) => ({
				type: `${p.kind}.request`,
				payload: p,
				generation: typeof p.execution_generation === 'number' ? p.execution_generation : ready.generation,
			}))
		if (claimed && isClaimed(ready.generation)) return asked.forEach((ev) => claimed!.feed(ev))
		if (ready.generation !== null && done.has(ready.generation)) return
		if (!current || current.generation !== ready.generation) {
			endCurrent()
			current = { generation: ready.generation, feed: opts.onTurn?.(ready.generation, true, session) }
		}
		for (const ev of asked) current.feed?.event(ev)
	}

	const pump = async (events: AsyncIterable<WatchEvent>) => {
		try {
			for await (const ev of events) onEvent(ev)
		} catch {
			// Dropped: handled below like an end.
		}
		if (closed) return
		// The relay lost Hermes' socket. A turn sent from here still ends with its own stream.
		connected = false
		endCurrent(false)
		if (opts.reattach) again(0)
	}

	const again = (tries: number) => {
		retry = setTimeout(
			async () => {
				if (closed) return
				abort = new AbortController()
				const next = await source(profile, sessionId, abort.signal).catch(() => null)
				if (closed || !next) abort.abort()
				if (closed) return
				if (!next) return again(tries + 1)
				connected = true
				attached(next.ready)
				void pump(next.events)
			},
			RETRY_MS[Math.min(tries, RETRY_MS.length - 1)],
		)
	}

	attached(first.ready)
	void pump(first.events)

	return {
		get session() {
			return session
		},
		get connected() {
			return connected
		},
		claim(feed) {
			const c = { skip: current?.generation ?? null, feed } as NonNullable<typeof claimed>
			claimed = c
			return (goesOn = false) => {
				if (claimed !== c) return
				claimed = null
				// Late events of this turn are not a new one, unless the turn goes on without its sender.
				if (c.generation !== undefined && !goesOn) done.add(c.generation)
			}
		},
		close() {
			closed = true
			clearTimeout(retry)
			abort.abort()
		},
	}
}

/** The relay's view of a Bot Chat, over Server-Sent Events. */
const relay: WatchSource = async (profile, sessionId, signal) => {
	// Aborted by the watch, or when the relay does not say it is ready in time.
	const both = new AbortController()
	const stop = () => both.abort()
	signal.addEventListener('abort', stop, { once: true })
	const timer = setTimeout(stop, READY_MS)
	try {
		const res = await fetch(
			url(`ui-api/bots/${encodeURIComponent(profile)}/watch?session=${encodeURIComponent(sessionId)}`),
			{ headers: { Accept: 'text/event-stream' }, signal: both.signal },
		)
		if (!res.ok) return null
		const frames = readSse(res, both.signal)
		const first = await frames.next()
		if (first.done || first.value.event !== 'ready') return null
		clearTimeout(timer)
		const r = JSON.parse(first.value.data)
		async function* events(): AsyncGenerator<WatchEvent> {
			for await (const f of frames) {
				if (f.event === 'ping' || !f.event) continue
				const d = JSON.parse(f.data)
				yield { type: f.event, payload: d.payload ?? d, generation: d.generation ?? null }
			}
		}
		return {
			ready: {
				session: r.session,
				running: !!r.running,
				generation: r.generation ?? null,
				prompts: Array.isArray(r.prompts) ? r.prompts : [],
			},
			events: events(),
		}
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}
