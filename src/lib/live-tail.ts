import { contentText, type Message } from './gateway'
import { buildTurns, type AgentTurn, type Step, type Turn } from './turns'

/**
 * A chat while a turn runs in it: the saved transcript, then the running turn after it. Hermes saves the turn as it
 * goes (the message that began it, then its steps), so the transcript has to stop where the running turn starts or
 * the turn shows twice. Where it stops depends on how the turn is known here; that is all decided in this module.
 *
 *   liveTurns(messages, { kind: 'sent', turn, user, after: newestId(held) }, { older })
 */
export type LiveTail =
	/** Sent from here: the message shows from here too, so the transcript stops before it. */
	| { kind: 'sent'; turn: AgentTurn; user: { text: string; images: string[] }; after?: number }
	/**
	 * Watched on the Hermes socket: the message that began it comes from the transcript, even when Hermes saved it
	 * after the turn had started (it was sent from another device).
	 */
	| { kind: 'watched'; turn: AgentTurn; after?: number }
	/** Running elsewhere and followed through the transcript: what it waits for joins the last saved turn. */
	| { kind: 'followed'; waiting: Step[] }

/** The turns to show for a chat; `older` says the server has messages before the ones held. */
export function liveTurns(ms: Message[], tail: LiveTail | undefined, opts: { older?: boolean } = {}): Turn[] {
	const saved =
		tail?.kind === 'sent'
			? turnsOf(beforeSent(ms, tail))
			: tail?.kind === 'watched' && tail.after !== undefined
				? turnsOf(upToTurn(ms, tail.after))
				: turnsOf(ms)
	// A page can start in the middle of the agent's work; that turn shows once its start is loaded.
	const turns = opts.older && saved[0]?.kind === 'agent' && saved.length > 1 ? saved.slice(1) : [...saved]
	if (!tail) return turns
	switch (tail.kind) {
		case 'sent':
			turns.push({ kind: 'user', key: 'live-user', text: tail.user.text, images: tail.user.images }, tail.turn)
			return turns
		case 'watched':
			turns.push(tail.turn)
			return turns
		case 'followed': {
			const last = turns.at(-1)
			// A copy: the saved turns are shared and must not be marked live.
			const turn: AgentTurn =
				last?.kind === 'agent'
					? { ...last, steps: [...last.steps, ...tail.waiting], live: true }
					: { kind: 'agent', key: 'remote-agent', steps: [...tail.waiting], reasoning: '', live: true }
			if (last?.kind === 'agent') turns[turns.length - 1] = turn
			else turns.push(turn)
			return turns
		}
	}
}

/** The newest message held. A turn starting now is everything saved after it. */
export function newestId(ms: Message[]): number | undefined {
	let newest: number | undefined
	for (const m of ms) {
		const n = Number(m.id)
		if (Number.isFinite(n) && (newest === undefined || n > newest)) newest = n
	}
	return newest
}

/** The newest message from a person. A turn already running when it was found started right after it. */
export function startId(ms: Message[]): number | undefined {
	for (let i = ms.length - 1; i >= 0; i--) {
		if (ms[i]!.role !== 'user') continue
		const n = Number(ms[i]!.id)
		return Number.isFinite(n) ? n : undefined
	}
}

/**
 * Whether the message that began a watched turn is held. `after` is where the turn was cut (none: nothing was held
 * then): the message is either the last one up to it, or arrived after it because Hermes saved it late. A routine's
 * turn has none.
 */
export function turnStartHeld(ms: Message[], after: number | undefined): boolean {
	let last: Message | undefined
	for (const m of ms) {
		const n = Number(m.id)
		if (after === undefined || n > after) {
			if (m.role === 'user') return true
		} else last = m
	}
	return last?.role === 'user'
}

/**
 * The work of the turn running now, read from the messages Hermes saved after `after`: for a turn whose stream
 * carries no steps (a bot's Bot Chat runs in the bot's own queue and reports only its end). Calls whose results
 * are not saved yet are still running.
 */
export function savedProgress(ms: Message[], after: number): Pick<AgentTurn, 'steps' | 'reasoning'> | null {
	const fresh = ms.filter((m) => Number(m.id) > after && m.role !== 'user')
	const turn = buildTurns(fresh)
		.filter((t): t is AgentTurn => t.kind === 'agent')
		.at(-1)
	if (!turn) return null
	for (const s of turn.steps) if (s.kind === 'tool' && s.output == null) s.status = 'running'
	return { steps: turn.steps, reasoning: turn.reasoning }
}

/** The key the newest reply has once it is saved, which is where its run's speed is kept. */
export function lastReplyKey(ms: Message[]): string | undefined {
	const last = turnsOf(ms).at(-1)
	return last?.kind === 'agent' ? last.key : undefined
}

// Turns are derived from a transcript array that is replaced, never mutated, so they are cached per array, and so
// are the cuts of it while a turn runs.
const turnCache = new WeakMap<Message[], Turn[]>()
function turnsOf(ms: Message[]) {
	let t = turnCache.get(ms)
	if (!t) turnCache.set(ms, (t = buildTurns(ms)))
	return t
}

const cutCache = new WeakMap<Message[], { at: number; ms: Message[] }>()
function upTo(ms: Message[], at: number) {
	const c = cutCache.get(ms)
	if (c?.at === at) return c.ms
	const cut = ms.filter((m) => !(Number(m.id) > at))
	cutCache.set(ms, { at, ms: cut })
	return cut
}

/** The transcript up to `at`, plus the message that began the turn when it was saved after the cut. */
const turnCutCache = new WeakMap<Message[], { at: number; ms: Message[] }>()
function upToTurn(ms: Message[], at: number) {
	const c = turnCutCache.get(ms)
	if (c?.at === at) return c.ms
	let end = ms.findIndex((m) => Number(m.id) > at)
	if (end < 0) end = ms.length
	while (end < ms.length && ms[end]!.role === 'user') end++
	const cut = ms.slice(0, end)
	turnCutCache.set(ms, { at, ms: cut })
	return cut
}

/**
 * The transcript above a turn sent from here. Opening the chat again reads it fresh, and by then Hermes has saved
 * the message that started the turn (and maybe its first steps): those show live, not twice.
 */
function beforeSent(ms: Message[], tail: { user: { text: string }; after?: number }) {
	if (tail.after !== undefined) return upTo(ms, tail.after)
	// Sent before the chat had loaded: cut at the message itself, the newest one from the user with its text.
	let i = ms.length - 1
	while (i >= 0 && ms[i]!.role !== 'user') i--
	if (i < 0 || contentText(ms[i]!.content).trim() !== tail.user.text.trim()) return ms
	return i === 0 ? [] : upTo(ms, Number(ms[i - 1]!.id))
}
