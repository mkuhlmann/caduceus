import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')

// Installable app: register the service worker in production builds. The desktop app (which binds
// caduceusOpenExternal) loads from a local relay and has no use for it.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('caduceusOpenExternal' in window)) {
	addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
