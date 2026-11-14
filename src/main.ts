import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { fitToVisibleViewport } from './lib/viewport'
import { registerServiceWorker } from './lib/pwa'
import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')
fitToVisibleViewport()

// Load every page's code once the first screen is idle, so the first visit to a page doesn't wait on the network.
const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 300))
idle(() => {
	for (const r of router.getRoutes()) {
		const c = r.components?.default
		if (typeof c === 'function') (c as () => Promise<unknown>)().catch(() => {})
	}
})

// Installable app: register the service worker in production builds. The desktop app (which binds
// caduceusOpenExternal) loads from a local relay and has no use for it.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('caduceusOpenExternal' in window)) {
	addEventListener('load', registerServiceWorker)
}

// A home-screen shortcut opened while the app is running focuses this window (`launch_handler` in the manifest)
// and hands over its address; the route is in the hash.
type LaunchParams = { targetURL?: string }
const launchQueue = (window as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue
launchQueue?.setConsumer(({ targetURL }) => {
	const route = targetURL ? new URL(targetURL).hash.replace(/^#/, '') : ''
	if (route && route !== router.currentRoute.value.fullPath) router.push(route)
})
