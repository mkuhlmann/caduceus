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

// ── Notifications (server/notify.ts sends them; src/lib/push.ts subscribes) ─────────────────────────

self.addEventListener('push', (event) => {
	let msg = {}
	try {
		msg = event.data ? event.data.json() : {}
	} catch {}
	if (msg.type === 'clear') {
		// Read on another device: its notification here has nothing left to say.
		event.waitUntil(self.registration.getNotifications({ tag: msg.tag }).then((list) => list.forEach((n) => n.close())))
		return
	}
	event.waitUntil(
		self.registration.showNotification(msg.title || 'Caduceus', {
			body: msg.body || '',
			tag: msg.tag,
			renotify: !!msg.tag,
			icon: new URL('icons/icon-192.png', scope).href,
			badge: new URL('icons/badge-96.png', scope).href,
			data: { route: msg.route || '/' },
			timestamp: Date.now(),
		}),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	const route = event.notification.data?.route || '/'
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
			// A window of the app is open: it moves to the chat itself, without a reload.
			const open = list.find((c) => c.url.startsWith(scope))
			if (open) {
				open.postMessage({ type: 'open', route })
				return open.focus()
			}
			return self.clients.openWindow(scope + '#' + route)
		}),
	)
})

// The browser replaced the subscription by itself: tell the relay, which knows the device by its old one.
self.addEventListener('pushsubscriptionchange', (event) => {
	const old = event.oldSubscription
	event.waitUntil(
		(event.newSubscription
			? Promise.resolve(event.newSubscription)
			: old
				? self.registration.pushManager.subscribe(old.options)
				: Promise.resolve(null)
		).then((sub) =>
			sub && old
				? fetch(new URL('ui-api/notify/renew', scope), {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
					})
				: undefined,
		),
	)
})
