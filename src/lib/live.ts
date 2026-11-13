import { onEventsReconnected, reopenEvents } from './rpc'

/**
 * Catching up after the app was away. A phone puts a PWA to sleep, a laptop loses its network, the relay restarts:
 * every change Hermes or another device made meanwhile was missed, because change events are not kept. When the app
 * comes back (shown again after a while, back online, the event stream reconnected) everything that registered here
 * reads its data again, once per return.
 *
 *   onResync(() => load())   // in a store, or in a component (removed with it)
 */

type Resync = () => unknown
const handlers = new Set<Resync>()

// A glance at another tab is not a return: only after this long hidden does showing the app read everything again.
const AWAY_MS = 15_000
// Several signals of one return (shown, online, reconnected) read once.
const SETTLE_MS = 3000

let hiddenAt = document.hidden ? Date.now() : 0
let lastResync = 0

/** Read again whenever the app comes back; returns the unregister. */
export function onResync(fn: Resync): () => void {
	handlers.add(fn)
	return () => handlers.delete(fn)
}

/** Everything that registered reads its data again now. */
export function resync() {
	const now = Date.now()
	if (now - lastResync < SETTLE_MS) return
	lastResync = now
	for (const fn of handlers) {
		try {
			void Promise.resolve(fn()).catch(() => {})
		} catch {
			// One failing reader must not keep the others stale.
		}
	}
}

document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		hiddenAt = Date.now()
		return
	}
	const away = hiddenAt && Date.now() - hiddenAt >= AWAY_MS
	hiddenAt = 0
	if (!away) return
	// The event stream may look open after a sleep while nothing arrives on it: start it again.
	reopenEvents()
	resync()
})

addEventListener('online', () => {
	reopenEvents()
	resync()
})

// Restored from the browser's back-forward cache: frozen since it was left.
addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && resync())

onEventsReconnected(resync)
