import { expect, test } from 'bun:test'
import { advance, isEmpty, noMarks, parseMarks } from '@/lib/read-marks'

test('a mark moves forward and reports what moved', () => {
	const marks = { bots: { scout: 100 }, rooms: { r1: 4 } }
	const { next, moved } = advance(marks, { bots: { scout: 120, ops: 50 }, rooms: { r1: 4 } })
	expect(next).toEqual({ bots: { scout: 120, ops: 50 }, rooms: { r1: 4 } })
	expect(moved).toEqual({ bots: { scout: 120, ops: 50 }, rooms: {} })
	// The input is left as it was.
	expect(marks).toEqual({ bots: { scout: 100 }, rooms: { r1: 4 } })
})

test('an older mark from another device never moves one back', () => {
	const { next, moved } = advance(
		{ bots: { scout: 120 }, rooms: { r1: 9 } },
		{ bots: { scout: 100 }, rooms: { r1: 3 } },
	)
	expect(next).toEqual({ bots: { scout: 120 }, rooms: { r1: 9 } })
	expect(isEmpty(moved)).toBe(true)
})

test('devices writing in any order end on the furthest marks', () => {
	const a = { bots: { scout: 120 }, rooms: { r1: 2 } }
	const b = { bots: { scout: 90, ops: 10 }, rooms: { r1: 7 } }
	const ab = advance(advance(noMarks(), a).next, b).next
	const ba = advance(advance(noMarks(), b).next, a).next
	expect(ab).toEqual({ bots: { scout: 120, ops: 10 }, rooms: { r1: 7 } })
	expect(ba).toEqual(ab)
})

test('a room read from its start (seq 0) counts as marked', () => {
	const { next, moved } = advance(noMarks(), { rooms: { r1: 0 } })
	expect(next.rooms.r1).toBe(0)
	expect(isEmpty(moved)).toBe(false)
})

test('marks from outside are checked', () => {
	expect(parseMarks({ bots: { scout: 1.5 } })).toEqual({ bots: { scout: 1.5 }, rooms: {} })
	expect(parseMarks({})).toEqual(noMarks())
	expect(parseMarks(null)).toBeString()
	expect(parseMarks([])).toBeString()
	expect(parseMarks({ chats: {} })).toBeString()
	expect(parseMarks({ bots: { scout: '5' } })).toBeString()
	expect(parseMarks({ rooms: { r1: -1 } })).toBeString()
	expect(parseMarks({ rooms: { r1: Number.NaN } })).toBeString()
})
