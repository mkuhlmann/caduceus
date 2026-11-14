import { Elysia } from 'elysia'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { broadcast } from './hermes-socket'
import { advance, isEmpty, noMarks, parseMarks, type ReadMarks } from '../src/lib/read-marks'

/**
 * How far you have read each bot's chat and group chat, shared by all your devices (see `src/lib/read-marks.ts`).
 * Every answer carries the server's clock, so that devices whose own clocks differ still mark "read until now"
 * on one clock.
 */
const file = join(process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data'), 'read-marks.json')

function load(): ReadMarks {
	if (!existsSync(file)) return noMarks()
	try {
		const saved = parseMarks(JSON.parse(readFileSync(file, 'utf8')))
		return typeof saved === 'string' ? noMarks() : saved
	} catch {
		return noMarks()
	}
}

let marks = load()

const answer = () => ({ marks, now: Date.now() / 1000 })

export const readMarkRoutes = new Elysia({ prefix: '/ui-api/read-marks' })
	.get('/', answer)
	.patch('/', ({ body, set }) => {
		const patch = parseMarks(body ?? {})
		if (typeof patch === 'string') return ((set.status = 400), { error: patch })
		const { next, moved } = advance(marks, patch)
		if (!isEmpty(moved)) {
			marks = next
			mkdirSync(dirname(file), { recursive: true })
			writeFileSync(file, JSON.stringify(marks, null, 2))
			// Other devices take the marks at once.
			broadcast('caduceus.readMarks', moved)
		}
		return answer()
	})
