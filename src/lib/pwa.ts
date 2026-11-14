import { hasUnsentWork } from './drafts'

/**
 * The installed app's updates. The service worker (src/sw.js) opens the app from its cache, so a new deploy
 * never shows on its own: it installs in the background and waits. It takes over when:
 *
 * - every window of the app is closed (the phone ended it, or it was swiped away): the next launch is new;
 * - the app goes to the background with nothing typed and unsent: it switches and reloads out of sight.
 *
 * Coming back to the app after a while also asks the relay for a newer version, since a phone may keep the
 * same page alive for days without loading it again.
 */
export function registerServiceWorker() {
	const sw = navigator.serviceWorker
	// The first install takes control of a page that ran without one; only a switch between versions reloads.
	let reloadOnSwitch = !!sw.controller
	sw.addEventListener('controllerchange', () => {
		if (!reloadOnSwitch) return void (reloadOnSwitch = true)
		reloadOnSwitch = false
		location.reload()
	})

	sw.register('./sw.js')
		.then((reg) => {
			const applyIfIdle = () => {
				if (document.hidden && reg.waiting && sw.controller && !hasUnsentWork()) reg.waiting.postMessage('skip-waiting')
			}
			let hiddenAt = 0
			document.addEventListener('visibilitychange', () => {
				if (document.hidden) {
					hiddenAt = Date.now()
					return applyIfIdle()
				}
				if (hiddenAt && Date.now() - hiddenAt > 60_000) reg.update().catch(() => {})
			})
			// An update found while the app is already in the background applies once it is ready.
			reg.addEventListener('updatefound', () => {
				const next = reg.installing
				next?.addEventListener('statechange', () => next.state === 'installed' && applyIfIdle())
			})
		})
		.catch(() => {})
}
