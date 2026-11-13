/**
 * Reading something again and again while the app is shown: every `every` ms, when asked (`now`, `soon`, or one
 * of the `triggers`: a change event, the app coming back), and once more when it is shown again after a read came
 * due while it was hidden. However many of those overlap, one read runs at a time and the loop keeps one timer.
 *
 *   const runs = poller(() => syncRuns(), { every: 4000, triggers: [onResync], start: true })
 *   runs.soon(250) // something changed
 *   runs.stop()
 *
 * `read` is told whether it was asked for (`true`) or only came due (`false`), and may return the delay before
 * the next read when that depends on what it found.
 */
export type Poller = {
	/** Read now; a read under way is followed by one more. */
	now(): void
	/** Read within `ms`, unless a read is due sooner. */
	soon(ms: number): void
	stop(): void
}

export type PollerOptions = {
	every: number
	/** Subscriptions that ask for a read, each returning its unsubscribe: `onResync`, `(f) => onRpcEvent('x', f)`. */
	triggers?: Array<(fire: () => void) => () => void>
	/** Read at once instead of after the first `every`. */
	start?: boolean
}

export function poller(read: (asked: boolean) => unknown, opts: PollerOptions): Poller {
	let timer: ReturnType<typeof setTimeout> | undefined
	let due = Infinity
	let asked = false
	let running = false
	// Asked for while a read ran: the delay before the one after it.
	let queued: number | undefined
	let missed = false
	let stopped = false

	const schedule = (ms: number, ask: boolean) => {
		if (stopped) return
		asked ||= ask
		if (running) {
			queued = Math.min(queued ?? Infinity, ms)
			return
		}
		const at = Date.now() + ms
		if (timer !== undefined && due <= at) return
		clearTimeout(timer)
		due = at
		timer = setTimeout(run, ms)
	}

	const run = async () => {
		timer = undefined
		due = Infinity
		if (stopped) return
		if (document.hidden) {
			// Nothing reads while nobody looks: the read waits until the app is shown.
			missed = true
			return
		}
		const ask = asked
		asked = false
		running = true
		let next: unknown
		try {
			next = await read(ask)
		} catch {
			// The next read tries again.
		} finally {
			running = false
		}
		const after = typeof next === 'number' ? next : opts.every
		const q = queued
		queued = undefined
		schedule(Math.min(q ?? Infinity, after), false)
	}

	const shown = () => {
		if (document.hidden || !missed) return
		missed = false
		// Coming back counts as asking: what changed meanwhile was not seen.
		schedule(0, true)
	}
	document.addEventListener('visibilitychange', shown)
	const offs = (opts.triggers ?? []).map((on) => on(() => schedule(0, true)))

	schedule(opts.start ? 0 : opts.every, false)

	return {
		now: () => schedule(0, true),
		soon: (ms) => schedule(ms, true),
		stop() {
			stopped = true
			clearTimeout(timer)
			document.removeEventListener('visibilitychange', shown)
			for (const off of offs) off()
		},
	}
}
