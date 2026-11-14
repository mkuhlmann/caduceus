/**
 * Read marks: how far you have read each bot's chat and each group chat, kept on the Caduceus server so that what
 * you read on one device no longer shows as new on another. A bot's mark is a time in seconds (its Bot Chat's
 * `last_active` is newer: unread); a room's is the `seq` of the last event seen.
 *
 * Marks only move forward. Every device sends what it read, and the server keeps the furthest mark for each, so
 * devices never undo one another's reading, whatever order their writes arrive in. The server and the browser
 * share this module.
 */
export type ReadMarks = { bots: Record<string, number>; rooms: Record<string, number> }

export const KINDS = ['bots', 'rooms'] as const
export type MarkKind = (typeof KINDS)[number]

export const noMarks = (): ReadMarks => ({ bots: {}, rooms: {} })

export const isEmpty = (m: ReadMarks) => KINDS.every((k) => Object.keys(m[k]).length === 0)

/** The marks in `patch` that move past `marks`, and `marks` with them taken. */
export function advance(marks: ReadMarks, patch: Partial<ReadMarks>): { next: ReadMarks; moved: ReadMarks } {
	const next: ReadMarks = { bots: { ...marks.bots }, rooms: { ...marks.rooms } }
	const moved = noMarks()
	for (const kind of KINDS)
		for (const [key, at] of Object.entries(patch[kind] ?? {})) {
			const before = next[kind][key]
			if (before !== undefined && before >= at) continue
			next[kind][key] = moved[kind][key] = at
		}
	return { next, moved }
}

/** Marks from outside (a request body, a stored file), or why they are not marks. */
export function parseMarks(v: unknown): ReadMarks | string {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Read marks must be an object.'
	const out = noMarks()
	for (const [kind, group] of Object.entries(v)) {
		if (!(KINDS as readonly string[]).includes(kind)) return `Unknown kind of read mark "${kind}".`
		if (!group || typeof group !== 'object' || Array.isArray(group)) return `Read marks for ${kind} must be an object.`
		for (const [key, at] of Object.entries(group)) {
			if (typeof at !== 'number' || !Number.isFinite(at) || at < 0)
				return `${JSON.stringify(at)} is not a valid read mark for ${kind} "${key}".`
			out[kind as MarkKind][key] = at
		}
	}
	return out
}
