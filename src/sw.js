// Service worker for the installable app. The build (`pwa()` in vite.config.ts) fills in VERSION and
// PRECACHE, the list of every file in dist/, and writes the result to dist/sw.js.
//
// - The app shell is precached, so the installed app opens even when the relay is unreachable.
// - Page loads go to the network first, so a new deploy shows up on the next reload.
// - /ui-api/* is never touched: chat streams, auth and Hermes data always go straight to the relay.

const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = 'caduceus-' + VERSION
const scope = self.registration.scope
const api = new URL('ui-api/', scope).href
const shell = new URL('index.html', scope).href

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE.map((path) => new Request(new URL(path, scope), { cache: 'reload' }))))
			.then(() => self.skipWaiting()),
	)
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k.startsWith('caduceus-') && k !== CACHE).map((k) => caches.delete(k))),
			)
			.then(() => self.clients.claim()),
	)
})

self.addEventListener('fetch', (event) => {
	const { request } = event
	if (request.method !== 'GET' || !request.url.startsWith(scope) || request.url.startsWith(api)) return

	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(() => caches.match(shell, { cacheName: CACHE })))
		return
	}
	event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)))
})
