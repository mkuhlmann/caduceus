import { Elysia } from 'elysia'
import { Type } from '@sinclair/typebox'
import { broadcast } from './hermes-socket'
import { onMarksMoved } from './read-marks'
import { config, DeviceIdSchema, saveConfig, saveState, state, SubscriptionSchema, type Device } from './store'
import { createVapid, sendPush, topicOf, type Vapid } from './webpush'
import {
	activeDevices,
	audience,
	EVENT_KINDS,
	NotifyPatchSchema,
	tagOfMark,
	type Channel,
	type EventKind,
	type Notice,
	type NotifySettings,
	type Presence,
} from '../src/lib/notifications'

/**
 * Delivering notifications (`src/lib/notifications.ts` has the rules). Each device that turns them on in Settings
 * gets Web Push; the channels in the settings (ntfy topics, webhooks) get every notice too. What `notify-watch.ts`
 * sees in Hermes comes here as a notice.
 *
 * The settings are kept in `config.json`; the devices, the relay's VAPID key and Caduceus's address (for links in
 * channel messages, as the browser last reported it) in `state.json`.
 */

function rememberAppUrl(v: string | undefined) {
	if (!v) return
	try {
		const u = new URL(v)
		if (!['http:', 'https:'].includes(u.protocol)) return
		const clean = u.origin + u.pathname.replace(/[^/]*$/, '')
		if (clean === state.push.appUrl) return
		state.push.appUrl = clean
		saveState()
	} catch {}
}

/** A link that opens a route in Caduceus, for channels outside the app. */
const linkTo = (route: string) => (state.push.appUrl ? `${state.push.appUrl}#${route}` : undefined)

let vapid: Promise<Vapid> | undefined
function vapidKeys(): Promise<Vapid> {
	vapid ??= (async () => {
		const saved = state.push.vapid
		if (saved) return saved as Vapid
		const fresh = await createVapid()
		state.push.vapid = fresh as typeof state.push.vapid
		saveState()
		return fresh
	})()
	return vapid
}

/** The contact push services may use: Caduceus's own address, once a browser reported it over https. */
function subject() {
	const url = state.push.appUrl
	return url?.startsWith('https:') ? new URL(url).origin : 'https://github.com/mkuhlmann/caduceus'
}

/** Whether anything listens: a device or a channel, and at least one kind of notice turned on. */
export function wanted(kind?: EventKind) {
	const c = config.notifications
	const on = kind ? c.events[kind] : EVENT_KINDS.some((k) => c.events[k])
	return on && (state.push.devices.length > 0 || c.channels.length > 0)
}

// ── Presence ─────────────────────────────────────────────────────────────────────────────────────

const presence = new Map<string, Presence>()

// ── Delivery ─────────────────────────────────────────────────────────────────────────────────────

/** The same news about the same thing within this time is one notice (two sources may see one turn end). */
const REPEAT_MS = 30_000
const lastSent = new Map<string, number>()
/** Tags each device was shown, so reading a chat elsewhere can clear them. Not kept across restarts. */
const shown = new Map<string, Set<string>>()

type Delivery = { devices: number; channels: number; failed: string[] }

/** Tell everyone who should hear of it. `test` skips the settings and the presence rules. */
export async function notify(n: Notice, opts: { test?: boolean } = {}): Promise<Delivery> {
	const out: Delivery = { devices: 0, channels: 0, failed: [] }
	const c = config.notifications
	const now = Date.now()
	let skip = new Set<string>()
	if (!opts.test) {
		if (!c.events[n.kind]) return out
		const key = `${n.kind}|${n.tag}`
		if (now - (lastSent.get(key) ?? 0) < REPEAT_MS) return out
		const who = audience(n, activeDevices(presence.values(), now), c.quietWhileActive)
		if (!who.send) return out
		skip = who.skipDevices
		lastSent.set(key, now)
		for (const [k, at] of lastSent) if (now - at > REPEAT_MS) lastSent.delete(k)
	}

	const payload = JSON.stringify({ type: 'notice', ...n, body: n.body.slice(0, 1500) })
	const keys = await vapidKeys()
	const topic = await topicOf(n.tag)
	const urgency = n.kind === 'waiting' || n.kind === 'room' ? 'high' : 'normal'
	const pushes = state.push.devices
		.filter((d) => !skip.has(d.device))
		.map(async (d) => {
			const r = await sendPush(d, payload, keys, subject(), { ttl: 24 * 3600, urgency, topic })
			if (r.result === 'sent') {
				out.devices++
				let tags = shown.get(d.endpoint)
				if (!tags) shown.set(d.endpoint, (tags = new Set()))
				tags.add(n.tag)
			} else if (r.result === 'gone') forget(d.endpoint)
			else out.failed.push(`${d.label}: ${r.status || ''} ${r.detail ?? ''}`.trim())
		})
	const channels = c.channels.map(async (t) => {
		try {
			await sendToChannel(t, n)
			out.channels++
		} catch (e) {
			out.failed.push(`${t.url}: ${(e as Error).message}`)
		}
	})
	await Promise.all([...pushes, ...channels])
	if (out.failed.length) console.warn(`Notification "${n.title}" did not reach: ${out.failed.join('; ')}`)
	return out
}

async function sendToChannel(t: Channel, n: Notice) {
	const click = linkTo(n.route)
	let res: Response
	if (t.kind === 'ntfy') {
		// JSON publishing carries any characters in the title; it goes to the server's root with the topic inside.
		const u = new URL(t.url)
		const topic = u.pathname.split('/').filter(Boolean).pop()
		if (!topic) throw new Error('The ntfy address names no topic.')
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		if (t.token) headers.Authorization = `Bearer ${t.token}`
		res = await fetch(new URL(u.pathname.replace(/[^/]*\/?$/, ''), u.origin), {
			method: 'POST',
			headers,
			body: JSON.stringify({
				topic,
				title: n.title,
				message: n.body || n.title,
				priority: n.kind === 'waiting' || n.kind === 'room' ? 4 : 3,
				...(click ? { click } : {}),
			}),
			signal: AbortSignal.timeout(10_000),
		})
	} else {
		res = await fetch(t.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...n, url: click ?? null, at: new Date().toISOString() }),
			signal: AbortSignal.timeout(10_000),
		})
	}
	if (!res.ok) throw new Error(`answered ${res.status}`)
	await res.body?.cancel()
}

/**
 * Close a tag's notifications on every device that was shown one: you read it somewhere. Apple's push service drops
 * a subscription whose pushes show nothing, so those devices keep theirs until the app is opened.
 */
async function clear(tag: string) {
	const keys = await vapidKeys()
	const topic = await topicOf(tag)
	const payload = JSON.stringify({ type: 'clear', tag })
	await Promise.all(
		state.push.devices.map(async (d) => {
			const tags = shown.get(d.endpoint)
			if (!tags?.delete(tag) || new URL(d.endpoint).hostname.endsWith('push.apple.com')) return
			const r = await sendPush(d, payload, keys, subject(), { ttl: 3600, urgency: 'normal', topic })
			if (r.result === 'gone') forget(d.endpoint)
		}),
	)
}

onMarksMoved((moved) => {
	for (const key of Object.keys(moved.bots)) void clear(tagOfMark('bots', key))
	for (const key of Object.keys(moved.rooms)) void clear(tagOfMark('rooms', key))
})

function forget(endpoint: string) {
	const before = state.push.devices.length
	state.push.devices = state.push.devices.filter((d) => d.endpoint !== endpoint)
	shown.delete(endpoint)
	if (state.push.devices.length !== before) {
		saveState()
		broadcast('caduceus.notify')
	}
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────

/** A channel's token never goes back to the browser; this stands in for it and keeps it when sent back. */
const HIDDEN = '••••••••'

const answer = async () => ({
	config: {
		...config.notifications,
		channels: config.notifications.channels.map((t) => (t.kind === 'ntfy' && t.token ? { ...t, token: HIDDEN } : t)),
	},
	publicKey: (await vapidKeys()).publicKey,
	devices: state.push.devices.map((d) => ({ device: d.device, label: d.label, createdAt: d.createdAt })),
})

export const notifyRoutes = new Elysia({ prefix: '/ui-api/notify' })
	.get('/', answer)
	.patch(
		'/',
		async ({ body }) => {
			const { appUrl, events, ...rest } = body
			rememberAppUrl(appUrl)
			const next: NotifySettings = {
				...config.notifications,
				...rest,
				events: { ...config.notifications.events, ...events },
			}
			next.channels = next.channels.map((t) => {
				if (t.kind !== 'ntfy' || t.token !== HIDDEN) return t
				const kept = config.notifications.channels.find((s) => s.kind === 'ntfy' && s.url === t.url)
				return kept?.kind === 'ntfy' && kept.token ? { ...t, token: kept.token } : { kind: 'ntfy', url: t.url }
			})
			config.notifications = next
			saveConfig()
			broadcast('caduceus.notify')
			return answer()
		},
		{ body: NotifyPatchSchema },
	)
	.put(
		'/devices/:device',
		async ({ params, body }) => {
			rememberAppUrl(body.appUrl)
			const sub = body.subscription
			const label = body.label?.trim().slice(0, 80) || 'A device'
			const devices = state.push.devices
			const known = devices.find((d) => d.device === params.device)
			if (known && known.endpoint !== sub.endpoint) shown.delete(known.endpoint)
			const device: Device = {
				endpoint: sub.endpoint,
				keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
				device: params.device,
				label,
				createdAt: known?.createdAt ?? Date.now(),
			}
			state.push.devices = [...devices.filter((d) => d.device !== params.device && d.endpoint !== sub.endpoint), device]
			saveState()
			broadcast('caduceus.notify')
			return answer()
		},
		{
			params: Type.Object({ device: DeviceIdSchema }),
			body: Type.Object({
				subscription: SubscriptionSchema,
				label: Type.Optional(Type.String()),
				appUrl: Type.Optional(Type.String()),
			}),
		},
	)
	.delete('/devices/:device', async ({ params }) => {
		const known = state.push.devices.find((d) => d.device === params.device)
		if (known) forget(known.endpoint)
		return answer()
	})
	// The browser replaced a subscription by itself (the service worker's pushsubscriptionchange).
	.post(
		'/renew',
		({ body, set }) => {
			const known = state.push.devices.find((d) => d.endpoint === body.oldEndpoint)
			if (!known) {
				set.status = 404
				return { error: { message: 'No device has that subscription.', code: 'not_found' } }
			}
			shown.delete(known.endpoint)
			known.endpoint = body.subscription.endpoint
			known.keys = { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth }
			saveState()
			return { ok: true }
		},
		{ body: Type.Object({ oldEndpoint: Type.String(), subscription: SubscriptionSchema }) },
	)
	.post(
		'/presence',
		({ body }) => {
			if (body.active)
				presence.set(body.device, { device: body.device, viewing: body.viewing?.slice(0, 300) ?? null, at: Date.now() })
			else presence.delete(body.device)
			return { ok: true }
		},
		{
			body: Type.Object({
				device: DeviceIdSchema,
				active: Type.Boolean(),
				viewing: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			}),
		},
	)
	.post('/test', () =>
		notify(
			{
				kind: 'reply',
				tag: 'caduceus:test',
				title: 'Caduceus',
				body: 'Notifications reach this device. This is how a reply will show.',
				route: '/settings/notifications',
			},
			{ test: true },
		),
	)
