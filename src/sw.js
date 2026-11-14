// Service worker for the installable app. The build (`pwa()` in vite.config.ts) fills in VERSION and
// PRECACHE, the list of every file in dist/, and writes the result to dist/sw.js.
//
// - The app shell is precached and opening the app is answered from it, so the first frame never waits on
//   the network, however slow the relay or the phone's signal is.
// - A new deploy installs in the background and waits. It takes over once no window runs the old version, or
//   when the app asks (`skip-waiting`, sent by src/lib/pwa.ts while the app is in the background).
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
			.then((cache) => cache.addAll(PRECACHE.map((path) => new Request(new URL(path, scope), { cache: 'reload' })))),
	)
})

self.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') self.skipWaiting()
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

/** The app's own page: the scope itself or its index.html. The router lives in the hash, so that is every launch. */
function isShell(url) {
	const u = new URL(url)
	u.search = ''
	u.hash = ''
	return u.href === scope || u.href === shell
}

self.addEventListener('fetch', (event) => {
	const { request } = event
	if (request.method !== 'GET' || !request.url.startsWith(scope) || request.url.startsWith(api)) return

	if (request.mode === 'navigate') {
		if (!isShell(request.url)) return
		event.respondWith(caches.match(shell, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)))
		return
	}
	event.respondWith(caches.match(request, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)))
})
