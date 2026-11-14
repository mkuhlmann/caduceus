import { Elysia } from 'elysia'
import { broadcast } from './hermes-socket'
import { saveState, state } from './store'
import { advance, isEmpty, ReadMarksPatchSchema, type ReadMarks } from '../src/lib/read-marks'

/**
 * How far you have read each bot's chat and group chat, shared by all your devices (see `src/lib/read-marks.ts`),
 * kept in `state.json`. Every answer carries the server's clock, so that devices whose own clocks differ still mark
 * "read until now" on one clock.
 */
const answer = () => ({ marks: state.readMarks, now: Date.now() / 1000 })

/** The marks as they stand. */
export const currentMarks = () => state.readMarks

const readers = new Set<(moved: ReadMarks) => void>()
/** Hear of every mark that moves, on any device (notifications clear what was read). */
export function onMarksMoved(fn: (moved: ReadMarks) => void) {
	readers.add(fn)
}

export const readMarkRoutes = new Elysia({ prefix: '/ui-api/read-marks' }).get('/', answer).patch(
	'/',
	({ body }) => {
		const { next, moved } = advance(state.readMarks, body)
		if (!isEmpty(moved)) {
			state.readMarks = next
			saveState()
			// Other devices take the marks at once.
			broadcast('caduceus.readMarks', moved)
			for (const fn of readers) fn(moved)
		}
		return answer()
	},
	{ body: ReadMarksPatchSchema },
)
