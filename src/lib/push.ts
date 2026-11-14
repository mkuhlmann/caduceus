import type { Router } from 'vue-router'
import { del, get, put, request, url } from './http'
import { tagOfRoute, type NotifySettings } from './notifications'

/**
 * This device's side of notifications (`server/notify.ts` sends them, `src/sw.js` shows them):
 *
 * - turning them on subscribes the browser to Web Push and hands the subscription to the relay;
 * - while the app is in use it tells the relay so (`presence`), with the chat it shows, so that nothing notifies
 *   about what you are looking at, and, if you want, nothing at all while you use Caduceus;
 * - opening a chat closes its notifications here, and tapping one opens its chat in the running app.
 */

export type NotifyState = {
	config: NotifySettings
	publicKey: string
	devices: { device: string; label: string; createdAt: number }[]
}

const DEVICE_KEY = 'caduceus.device'

/** This browser's id with the relay, made once. */
export function deviceId(): string {
	let id = localStorage.getItem(DEVICE_KEY)
	if (!id) {
		id = crypto.randomUUID().replaceAll('-', '')
		localStorage.setItem(DEVICE_KEY, id)
	}
	return id
}

/** Where Caduceus is, so the relay can link to it from ntfy and webhooks. */
const appUrl = () => url('')

export type Support = 'ready' | 'denied' | 'insecure' | 'install' | 'unsupported' | 'desktop' | 'dev'

const isIos = () =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
	matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** Whether this device can get notifications, and if not, what stands in the way. */
export function pushSupport(): Support {
	if ('caduceusOpenExternal' in window) return 'desktop'
	if (!import.meta.env.PROD) return 'dev'
	if (!window.isSecureContext) return 'insecure'
	if (isIos() && !isStandalone()) return 'install'
	if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
	if (Notification.permission === 'denied') return 'denied'
	return 'ready'
}

/** A name for this device in the list of those that get notifications. */
function deviceLabel() {
	const ua = navigator.userAgent
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\//.test(ua)
			? 'Firefox'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'Browser'
	const os = /Android/.test(ua)
		? 'Android'
		: isIos()
			? 'iPhone or iPad'
			: /Mac OS X/.test(ua)
				? 'Mac'
				: /Windows/.test(ua)
					? 'Windows'
					: /Linux/.test(ua)
						? 'Linux'
						: ''
	return `${browser}${os ? ' on ' + os : ''}${isStandalone() ? ', installed' : ''}`
}

const b64url = (buf: ArrayBuffer | null | undefined) =>
	buf
		? btoa(String.fromCharCode(...new Uint8Array(buf)))
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '')
		: ''

function fromB64url(s: string) {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
	return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const notifyState = () => get<NotifyState>('ui-api/notify')

/** This device's push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
	if (pushSupport() !== 'ready') return null
	const reg = await navigator.serviceWorker.getRegistration()
	return (await reg?.pushManager.getSubscription()) ?? null
}

/** Ask for permission, subscribe, and hand the subscription to the relay. Call it from a tap: browsers require it. */
export async function enablePush(publicKey: string): Promise<NotifyState> {
	const permission = await Notification.requestPermission()
	if (permission !== 'granted')
		throw new Error(
			permission === 'denied'
				? 'Notifications are blocked for Caduceus in this browser. Allow them in the site settings, then try again.'
				: 'Notifications were not allowed. Try again and choose Allow.',
		)
	const reg = await navigator.serviceWorker.ready
	let sub = await reg.pushManager.getSubscription()
	// One made for another relay key (the relay's data folder was reset) cannot be used.
	if (sub && b64url(sub.options.applicationServerKey) !== publicKey) {
		await sub.unsubscribe()
		sub = null
	}
	sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) })
	return put<NotifyState>(`ui-api/notify/devices/${deviceId()}`, {
		subscription: sub.toJSON(),
		label: deviceLabel(),
		appUrl: appUrl(),
	})
}

export async function disablePush(): Promise<NotifyState> {
	const sub = await currentSubscription().catch(() => null)
	await sub?.unsubscribe().catch(() => {})
	return del<NotifyState>(`ui-api/notify/devices/${deviceId()}`)
}

/** Close this device's notifications about what a route shows: it is being read. */
async function closeShown(tag: string | null) {
	if (!tag || !('serviceWorker' in navigator)) return
	const reg = await navigator.serviceWorker.getRegistration()
	for (const n of (await reg?.getNotifications({ tag })) ?? []) n.close()
}

/** In use: shown, focused, and touched within this long. */
const IDLE_MS = 2 * 60_000
/** While in use, the relay hears so at least this often (it forgets a device after 70 s). */
const REPEAT_MS = 30_000

/** Start this device's part: presence, closing what is read, opening what is tapped, keeping the subscription. */
export function startNotifications(router: Router) {
	let lastInput = Date.now()
	let sent = { active: false, viewing: null as string | null, at: 0 }

	const active = () => document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastInput < IDLE_MS
	function report() {
		const now = { active: active(), viewing: tagOfRoute(router.currentRoute.value.path), at: Date.now() }
		if (!now.active && !sent.active) return
		if (now.active === sent.active && now.viewing === sent.viewing && now.at - sent.at < REPEAT_MS) return
		sent = now
		// keepalive: the last word before the app goes to the background must still arrive.
		request('ui-api/notify/presence', {
			method: 'POST',
			json: { device: deviceId(), active: now.active, viewing: now.viewing },
			keepalive: true,
		}).catch(() => {})
	}

	const touched = () => {
		const idle = !sent.active
		lastInput = Date.now()
		if (idle) report()
	}
	for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
		addEventListener(type, touched, { passive: true, capture: true })
	document.addEventListener('visibilitychange', report)
	addEventListener('focus', report)
	addEventListener('blur', report)
	setInterval(report, 10_000)

	router.afterEach((to) => {
		report()
		void closeShown(tagOfRoute(to.path))
	})
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void closeShown(tagOfRoute(router.currentRoute.value.path))
	})

	// A tapped notification opens its chat in this window (src/sw.js).
	navigator.serviceWorker?.addEventListener('message', (e) => {
		const route = e.data?.type === 'open' ? String(e.data.route ?? '') : ''
		if (route && route !== router.currentRoute.value.fullPath) router.push(route)
	})

	void keepSubscription()
}

/** A browser may renew its subscription quietly; the relay gets the current one whenever the app starts. */
async function keepSubscription() {
	try {
		const sub = await currentSubscription()
		if (!sub || Notification.permission !== 'granted') return
		const state = await notifyState()
		if (!state.devices.some((d) => d.device === deviceId())) return
		await put(`ui-api/notify/devices/${deviceId()}`, {
			subscription: sub.toJSON(),
			label: deviceLabel(),
			appUrl: appUrl(),
		})
	} catch {}
}
