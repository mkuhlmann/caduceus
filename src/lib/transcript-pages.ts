import { gateway, type Message } from './gateway'

/**
 * Transcripts load from their end, as in Hermes Desktop: the newest page first, older pages as the reader
 * scrolls up. A chat of any length opens as fast as a short one, and the newest messages are never cut off.
 *
 * Offsets count back from the newest message, so messages written after a page loaded shift every older
 * page. Pages are therefore joined by message id (ids only grow), never by position.
 */

/** Messages in the first page: enough for the turns on screen a few times over. */
export const TAIL = 120
/** Messages re-read while following a run: what a few seconds of work can add. */
export const LIVE_TAIL = 40

export type Tail = { ms: Message[]; more: boolean }

const idOf = (m: Message | undefined) => (m?.id == null ? NaN : Number(m.id))

/** The newest `limit` messages, and whether older ones exist on the server. */
export async function fetchTail(id: string, limit: number): Promise<Tail> {
	const r = await gateway.messagesPage(id, { limit })
	// An older Hermes ignores `order` and pages from the oldest message: that page is not the end of the chat.
	if (r.pagination?.order !== 'latest') return { ms: await gateway.messages(id), more: false }
	return { ms: r.data, more: r.data.length >= r.pagination.limit }
}

/** The page of messages just before the newest `offset` ones. */
export async function fetchOlder(id: string, offset: number): Promise<Tail> {
	const r = await gateway.messagesPage(id, { limit: TAIL, offset })
	return { ms: r.data, more: r.data.length >= (r.pagination?.limit ?? TAIL) }
}

/**
 * Lay a fresh newest page over the messages held: the page wins for the span it covers, older messages
 * stay. Returns the page itself when it covers everything held, and null when the two do not meet (more
 * messages were written since than a page holds), so messages in between could be missing.
 */
export function mergeTail(held: Message[] | undefined, page: Message[], complete: boolean): Message[] | null {
	if (!held?.length || complete || !page.length) return page
	const first = idOf(page[0])
	if (Number.isNaN(first)) return page
	const cut = held.findIndex((m) => idOf(m) >= first)
	if (cut === 0) return page
	if (cut < 0) return null
	return [...held.slice(0, cut), ...page]
}

/** Put an older page before the messages held, without the ones already there. */
export function prependOlder(held: Message[], page: Message[]): Message[] {
	const first = idOf(held[0])
	const older = Number.isNaN(first) ? page : page.filter((m) => idOf(m) < first)
	return older.length ? [...older, ...held] : held
}
