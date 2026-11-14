import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, patch } from '@/lib/http'
import { onResync } from '@/lib/live'
import { onRpcEvent } from '@/lib/rpc'
import { advance, isEmpty, KINDS, noMarks, parseMarks, type MarkKind, type ReadMarks } from '@/lib/read-marks'

/** The server's marks with its clock, as `server/read-marks.ts` answers. */
type Answer = { marks: ReadMarks; now: number }

const KEY = 'caduceus.readMarks'
/** Where this browser kept its marks before they moved to the server. */
const LEGACY: Record<MarkKind, string> = { bots: 'caduceus.botSeen', rooms: 'caduceus.roomSeen' }
/** Reading a running turn marks it again with every step: what is read in this window goes out as one write. */
const SEND_MS = 500

function stored(key: string, wrap: (v: unknown) => unknown = (v) => v): ReadMarks {
	try {
		const m = parseMarks(wrap(JSON.parse(localStorage.getItem(key) ?? 'null') ?? {}))
		return typeof m === 'string' ? noMarks() : m
	} catch {
		return noMarks()
	}
}

/**
 * How far you have read each bot's chat and group chat, the same on all your devices (`src/lib/read-marks.ts`).
 * The bots and groups stores read and set them through `unread` and `markSeen`; this store keeps them in step
 * with the server.
 */
export const useReadMarks = defineStore('readMarks', () => {
	// The last copy seen paints at once, with what this browser kept before marks were shared.
	let start = stored(KEY)
	for (const kind of KINDS)
		start = advance(
			start,
			stored(LEGACY[kind], (v) => ({ [kind]: v })),
		).next
	const marks = ref<ReadMarks>(start)
	/**
	 * The server's marks were read at least once. Until then a chat this device has never seen may well be known
	 * to another one, so it must not be marked read from scratch.
	 */
	const synced = ref(false)
	/** The server's clock minus this device's, in seconds. */
	let skew = 0
	let unsent = noMarks()
	let timer: ReturnType<typeof setTimeout> | undefined

	function keep(m: ReadMarks) {
		marks.value = m
		localStorage.setItem(KEY, JSON.stringify(m))
	}

	/** Takes the server's answer; returns what this device read that the server does not know yet. */
	function take(a: Answer) {
		skew = a.now - Date.now() / 1000
		const { next, moved } = advance(a.marks, marks.value)
		keep(next)
		return moved
	}

	async function load() {
		const ahead = take(await get<Answer>('ui-api/read-marks'))
		// The old per-browser marks are in this store's copy now, and go to the server with the rest.
		for (const key of Object.values(LEGACY)) localStorage.removeItem(key)
		synced.value = true
		if (!isEmpty(ahead)) send(ahead)
	}

	function send(m: ReadMarks) {
		unsent = advance(unsent, m).next
		timer ??= setTimeout(flush, SEND_MS)
	}

	async function flush() {
		clearTimeout(timer)
		timer = undefined
		if (isEmpty(unsent)) return
		const body = unsent
		unsent = noMarks()
		// A write that fails is not retried by itself: the next load finds the server behind and sends it again.
		await patch<Answer>('ui-api/read-marks', body)
			.then(take)
			.catch(() => {})
	}

	/** Read up to `at` (a time for a bot, an event `seq` for a room); a mark never moves back. */
	function mark(kind: MarkKind, key: string, at: number) {
		const { next, moved } = advance(marks.value, { [kind]: { [key]: at } })
		if (isEmpty(moved)) return
		keep(next)
		send(moved)
	}

	/** Now by the server's clock, in seconds, so that every device marks "read until now" alike. */
	const now = () => Date.now() / 1000 + skew

	// Read on another device: the relay passes on what moved, and coming back to the app reads them all again.
	onRpcEvent('caduceus.readMarks', (moved) => {
		const m = parseMarks(moved)
		if (typeof m !== 'string') keep(advance(marks.value, m).next)
	})
	onResync(() => load().catch(() => {}))
	// A phone may put the app to sleep any time it is hidden: what was just read goes out first.
	document.addEventListener('visibilitychange', () => document.hidden && void flush())

	return { marks, synced, load, mark, now }
})
