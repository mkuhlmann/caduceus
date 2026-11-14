import { Elysia } from 'elysia'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { broadcast } from './hermes-socket'
import { onMarksMoved } from './read-marks'
import { createVapid, sendPush, topicOf, type PushTarget, type Vapid } from './webpush'
import {
	activeDevices,
	audience,
	defaultConfig,
	EVENT_KINDS,
	parseConfig,
	tagOfMark,
	type EventKind,
	type Notice,
	type NotifyConfig,
	type Presence,
	type Target,
} from '../src/lib/notifications'

/**
 * Delivering notifications (`src/lib/notifications.ts` has the rules). Each device that turns them on in Settings
 * gets Web Push; the channels in the settings (ntfy topics, webhooks) get every notice too. What `notify-watch.ts`
 * sees in Hermes comes here as a notice. Everything is set in the app, under Settings, Notifications.
 */

const dataDir = process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data')
const configFile = join(dataDir, 'notifications.json')
const devicesFile = join(dataDir, 'push-devices.json')
const vapidFile = join(dataDir, 'vapid.json')

function readJson<T>(file: string): T | undefined {
	if (!existsSync(file)) return undefined
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as T
	} catch {
		return undefined
	}
}

function writeJson(file: string, value: unknown, secret = false) {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify(value, null, 2), secret ? { mode: 0o600 } : undefined)
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────

/** The settings, and Caduceus's address as the browser last reported it (for links in channel messages). */
type Stored = NotifyConfig & { appUrl?: string }

let stored: Stored = (() => {
	const saved = readJson<Stored>(configFile)
	const parsed = saved ? parseConfig({ ...saved, appUrl: undefined }) : defaultConfig()
	return { ...(typeof parsed === 'string' ? defaultConfig() : parsed), appUrl: saved?.appUrl }
})()

export function config(): NotifyConfig {
	return { events: stored.events, quietWhileActive: stored.quietWhileActive, targets: stored.targets }
}

function rememberAppUrl(v: unknown) {
	if (typeof v !== 'string') return
	try {
		const u = new URL(v)
		if (!['http:', 'https:'].includes(u.protocol)) return
		const clean = u.origin + u.pathname.replace(/[^/]*$/, '')
		if (clean === stored.appUrl) return
		stored = { ...stored, appUrl: clean }
		writeJson(configFile, stored, true)
	} catch {}
}

/** A link that opens a route in Caduceus, for channels outside the app. */
const linkTo = (route: string) => (stored.appUrl ? `${stored.appUrl}#${route}` : undefined)

// ── Devices ──────────────────────────────────────────────────────────────────────────────────────

type Device = PushTarget & { device: string; label: string; createdAt: number }

let devices: Device[] = readJson<Device[]>(devicesFile) ?? []
const saveDevices = () => writeJson(devicesFile, devices, true)

let vapid: Promise<Vapid> | undefined
function vapidKeys(): Promise<Vapid> {
	vapid ??= (async () => {
		const saved = readJson<Vapid>(vapidFile)
		if (saved?.publicKey && saved.privateJwk) return saved
		const fresh = await createVapid()
		writeJson(vapidFile, fresh, true)
		return fresh
	})()
	return vapid
}

/** The contact push services may use: Caduceus's own address, once a browser reported it over https. */
function subject() {
	const url = stored.appUrl
	return url?.startsWith('https:') ? new URL(url).origin : 'https://github.com/mkuhlmann/caduceus'
}

/** Whether anything listens: a device or a channel, and at least one kind of notice turned on. */
export function wanted(kind?: EventKind) {
	const c = config()
	const on = kind ? c.events[kind] : EVENT_KINDS.some((k) => c.events[k])
	return on && (devices.length > 0 || c.targets.length > 0)
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
	const c = config()
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
	const pushes = devices
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
	const channels = c.targets.map(async (t) => {
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

async function sendToChannel(t: Target, n: Notice) {
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
		devices.map(async (d) => {
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
	const before = devices.length
	devices = devices.filter((d) => d.endpoint !== endpoint)
	shown.delete(endpoint)
	if (devices.length !== before) {
		saveDevices()
		broadcast('caduceus.notify')
	}
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

function parseSubscription(v: unknown): PushTarget | null {
	const s = v as PushTarget | null
	if (!s || typeof s.endpoint !== 'string' || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string')
		return null
	try {
		if (new URL(s.endpoint).protocol !== 'https:') return null
	} catch {
		return null
	}
	return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }
}

/** A channel's token never goes back to the browser; this stands in for it and keeps it when sent back. */
const HIDDEN = '••••••••'

const answer = async () => ({
	config: {
		...config(),
		targets: config().targets.map((t) => (t.kind === 'ntfy' && t.token ? { ...t, token: HIDDEN } : t)),
	},
	publicKey: (await vapidKeys()).publicKey,
	devices: devices.map((d) => ({ device: d.device, label: d.label, createdAt: d.createdAt })),
})

const fail = (set: { status?: number | string }, status: number, message: string, code?: string) => (
	(set.status = status),
	{ error: { message, code } }
)

export const notifyRoutes = new Elysia({ prefix: '/ui-api/notify' })
	.get('/', answer)
	.patch('/', async ({ body, set }) => {
		const b = { ...((body ?? {}) as Record<string, unknown>) }
		rememberAppUrl(b.appUrl)
		delete b.appUrl
		const next = parseConfig(b, stored)
		if (typeof next === 'string') return fail(set, 400, next, 'invalid_params')
		next.targets = next.targets.map((t) => {
			if (t.kind !== 'ntfy' || t.token !== HIDDEN) return t
			const kept = stored.targets.find((s) => s.kind === 'ntfy' && s.url === t.url) as { token?: string } | undefined
			return kept?.token ? { ...t, token: kept.token } : { kind: 'ntfy', url: t.url }
		})
		stored = { ...next, appUrl: stored.appUrl }
		writeJson(configFile, stored, true)
		broadcast('caduceus.notify')
		return answer()
	})
	.put('/devices/:device', async ({ params, body, set }) => {
		const b = (body ?? {}) as { subscription?: unknown; label?: unknown; appUrl?: unknown }
		const sub = parseSubscription(b.subscription)
		if (!DEVICE.test(params.device) || !sub)
			return fail(set, 400, 'The browser sent no usable push subscription.', 'invalid_params')
		rememberAppUrl(b.appUrl)
		const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : 'A device'
		const known = devices.find((d) => d.device === params.device)
		if (known?.endpoint !== sub.endpoint && known) shown.delete(known.endpoint)
		devices = [
			...devices.filter((d) => d.device !== params.device && d.endpoint !== sub.endpoint),
			{ ...sub, device: params.device, label, createdAt: known?.createdAt ?? Date.now() },
		]
		saveDevices()
		broadcast('caduceus.notify')
		return answer()
	})
	.delete('/devices/:device', async ({ params }) => {
		const known = devices.find((d) => d.device === params.device)
		if (known) forget(known.endpoint)
		return answer()
	})
	// The browser replaced a subscription by itself (the service worker's pushsubscriptionchange).
	.post('/renew', ({ body, set }) => {
		const b = (body ?? {}) as { oldEndpoint?: unknown; subscription?: unknown }
		const sub = parseSubscription(b.subscription)
		const known = devices.find((d) => d.endpoint === b.oldEndpoint)
		if (!sub || !known) return fail(set, 404, 'No device has that subscription.', 'not_found')
		shown.delete(known.endpoint)
		devices = devices.map((d) => (d === known ? { ...d, ...sub } : d))
		saveDevices()
		return { ok: true }
	})
	.post('/presence', ({ body, set }) => {
		const b = (body ?? {}) as { device?: unknown; active?: unknown; viewing?: unknown }
		if (typeof b.device !== 'string' || !DEVICE.test(b.device))
			return fail(set, 400, 'Which device is this?', 'invalid_params')
		if (b.active) {
			const viewing = typeof b.viewing === 'string' ? b.viewing.slice(0, 300) : null
			presence.set(b.device, { device: b.device, viewing, at: Date.now() })
		} else presence.delete(b.device)
		return { ok: true }
	})
	.post('/test', async () => {
		const r = await notify(
			{
				kind: 'reply',
				tag: 'caduceus:test',
				title: 'Caduceus',
				body: 'Notifications reach this device. This is how a reply will show.',
				route: '/settings/notifications',
			},
			{ test: true },
		)
		return r
	})
