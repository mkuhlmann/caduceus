/**
 * Read marks: how far you have read each bot's chat and each group chat, kept on the Caduceus server so that what
 * you read on one device no longer shows as new on another. A bot's mark is a time in seconds (its Bot Chat's
 * `last_active` is newer: unread); a room's is the `seq` of the last event seen.
 *
 * Marks only move forward. Every device sends what it read, and the server keeps the furthest mark for each, so
 * devices never undo one another's reading, whatever order their writes arrive in. The server and the browser
 * share this module.
 */
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { withoutDefaults } from './schema'

const Marks = Type.Record(Type.String(), Type.Number({ minimum: 0 }), { default: {} })
export const ReadMarksSchema = Type.Object({ bots: Marks, rooms: Marks }, { additionalProperties: false, default: {} })
export type ReadMarks = Static<typeof ReadMarksSchema>
/** Marks sent from a device: only the kinds it read. */
export const ReadMarksPatchSchema = Type.Partial(withoutDefaults(ReadMarksSchema), { additionalProperties: false })

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

/** Marks from outside (a request body, a stored copy), or why they are not marks. */
export function parseMarks(v: unknown): ReadMarks | string {
	if (!Value.Check(ReadMarksPatchSchema, v)) {
		const e = Value.Errors(ReadMarksPatchSchema, v).First()
		return `Read marks${e?.path ? ' ' + e.path : ''}: ${e?.message ?? 'not an object'}.`
	}
	return { bots: { ...v.bots }, rooms: { ...v.rooms } }
}
