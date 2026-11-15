/**
 * Views of Hermes chats on the relay's one socket, shared by everything in the relay that views a chat.
 *
 * Hermes gives a socket one subscription per chat: a second `session.resume` of the same chat answers with the
 * subscription it already has, and one `session.detach` ends it for everyone. Two devices showing the same Bot Chat,
 * a turn's own view next to the open chat's, or `/new` compacting it would each end the others' view without them
 * knowing: no events would come any more, and Hermes would decline the bot's questions because no viewer could
 * answer them. So views are counted here, and the subscription is let go of only when the last view ends.
 *
 * Hermes also ends a subscription whose events piled up (`session.replay_gap`); the chat is then viewed again at once,
 * so its viewers keep getting events and questions.
 *
 *   const v = await views.view('remi', sessionId)   // v.attached is Hermes' answer to the resume
 *   ...
 *   v.release()
 */

/** What Hermes answers a `session.resume` with. */
export type Attached = {
	session_id?: string
	subscription_id?: string
	running?: boolean
	execution_generation?: number
	revision?: number
	prompts?: Array<Record<string, unknown>>
}

/** One event on the socket, with `session_id` in `params` when it is about a chat. */
type Event = { type: string; params?: Record<string, any> }

/** The parts of the Hermes socket a view needs. */
export type ViewSocket = {
	rpc<T>(method: string, params: Record<string, unknown>): Promise<T>
	/** Listen to every event; returns the unsubscribe. */
	onEvent(fn: (event: Event) => void): () => void
}

export type View = {
	/** Hermes' answer to this view's resume: what runs and waits in the chat right now. */
	attached: Attached
	/** End this view. The chat's subscription ends with the last one. Safe to call more than once. */
	release(): void
}

export type SessionViews = {
	view(profile: string, sessionId: string): Promise<View>
	/** How many views a chat has now (tests and diagnostics). */
	count(profile: string, sessionId: string): number
}

// Hermes' own profile is the gateway's launch profile: it is addressed by naming none.
const scope = (profile: string) => (profile === 'default' ? {} : { profile })

type Entry = { profile: string; sessionId: string; subscriptionId: string; holders: number }

export function createSessionViews(socket: ViewSocket): SessionViews {
	const entries = new Map<string, Entry>()
	const keyOf = (profile: string, sessionId: string) => `${profile}\0${sessionId}`

	// One resume or detach at a time per bot: a detach must not overtake a resume that will get the same subscription.
	const queues = new Map<string, Promise<unknown>>()
	function serial<T>(profile: string, op: () => Promise<T>): Promise<T> {
		const run = (queues.get(profile) ?? Promise.resolve()).then(op)
		const tail = run.catch(() => {})
		queues.set(profile, tail)
		void tail.then(() => queues.get(profile) === tail && queues.delete(profile))
		return run
	}

	// Listening only while a chat is viewed: a listener keeps the socket reconnecting after Hermes closes it.
	let unlisten: (() => void) | undefined
	const listen = () => {
		if (entries.size) unlisten ??= socket.onEvent(onEvent)
		else {
			unlisten?.()
			unlisten = undefined
		}
	}

	function onEvent(e: Event) {
		// Every subscription went with the socket. Views still held end on their own (their streams were told).
		if (e.type === 'socket.closed') {
			entries.clear()
			return listen()
		}
		if (e.type !== 'session.replay_gap') return
		const sid = e.params?.session_id
		for (const entry of entries.values()) if (entry.sessionId === sid) reattach(entry)
	}

	/** Hermes ended the chat's subscription; view it again for those still viewing it. */
	function reattach(entry: Entry) {
		void serial(entry.profile, async () => {
			if (entries.get(keyOf(entry.profile, entry.sessionId)) !== entry) return
			const a = await socket.rpc<Attached>('session.resume', {
				...scope(entry.profile),
				session_id: entry.sessionId,
				omit_messages: true,
			})
			if (a.subscription_id) entry.subscriptionId = a.subscription_id
		}).catch(() => {})
	}

	function view(profile: string, sessionId: string): Promise<View> {
		return serial(profile, async () => {
			const attached = await socket.rpc<Attached>('session.resume', {
				...scope(profile),
				session_id: sessionId,
				omit_messages: true,
			})
			const sid = attached.session_id
			const subscriptionId = attached.subscription_id
			if (!sid || !subscriptionId) return { attached, release() {} }
			const key = keyOf(profile, sid)
			let entry = entries.get(key)
			if (!entry) {
				entry = { profile, sessionId: sid, subscriptionId, holders: 0 }
				entries.set(key, entry)
				listen()
			}
			// A new id means Hermes had ended the old subscription: everyone viewing the chat shares the new one.
			entry.subscriptionId = subscriptionId
			entry.holders++
			const held = entry
			let released = false
			return {
				attached,
				release() {
					if (released) return
					released = true
					void serial(profile, async () => {
						// Gone with the socket, or already ended: nothing of it is left at Hermes.
						if (entries.get(key) !== held || --held.holders > 0) return
						entries.delete(key)
						listen()
						// Never with an end reason: that would close the chat for every viewer, Hermes Desktop's too.
						await socket.rpc('session.detach', {
							...scope(profile),
							session_id: held.sessionId,
							subscription_id: held.subscriptionId,
						})
					}).catch(() => {})
				},
			}
		})
	}

	return {
		view,
		count: (profile, sessionId) => entries.get(keyOf(profile, sessionId))?.holders ?? 0,
	}
}
