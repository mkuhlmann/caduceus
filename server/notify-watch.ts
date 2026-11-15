import { onSocketEvent, rpc } from './hermes-socket'
import { relay } from './relay'
import { botTitles, connectedBots } from './bots'
import { onChatStream } from './runs'
import { currentMarks } from './read-marks'
import { notify, wanted } from './notify'
import {
	BOT_CHAT,
	botNotice,
	chatNotice,
	finishedRuns,
	liveChanges,
	preview,
	roomAsk,
	roomNotice,
	type JobLike,
	type LiveRow,
	type LiveSeen,
} from '../src/lib/notifications'

/**
 * Watching Hermes for what is worth a notification, whether or not a browser is open. Only while something listens
 * (`wanted`): a device turned notifications on, or a channel is set.
 *
 * - **A turn waits, a turn is done**: Hermes' `session.active_list` says, per bot, which chats run and whether they
 *   wait for an answer. The relay looks every few seconds. Chats started through the relay also report approvals
 *   and their end on their own stream (`runs.ts`). Only Bot Chats and chats started here count; a Telegram chat or a
 *   schedule's run is answered where it runs.
 * - **A room needs you**: Hermes pushes `groups.changed` naming the rooms that moved; a slow look covers the rest.
 * - **A schedule failed or ran**: Hermes pushes `cron.changed` when its jobs file moves; a slow look covers bots'
 *   jobs. A run that went well is told only if you asked (`scheduleRan`), with the start of what it produced.
 *
 * The first look at anything only learns how it stands, so a restart does not repeat old news.
 */

const POLL_MS = 5000
const SLOW_MS = 60_000

const scope = (profile: string) => (profile === 'default' ? {} : { profile })
const gwBase = (profile: string) => (profile === 'default' ? '' : `/p/${encodeURIComponent(profile)}`)

async function gw<T>(path: string): Promise<T> {
	const res = await relay('gw', path.replace(/\?.*/, ''), new Request('http://relay' + path))
	if (!res.ok) {
		await res.body?.cancel()
		throw new Error(`Hermes answered ${res.status}`)
	}
	return (await res.json()) as T
}

async function dash<T>(path: string): Promise<T> {
	const res = await relay('dash', path.replace(/\?.*/, ''), new Request('http://relay' + path))
	if (!res.ok) {
		await res.body?.cancel()
		throw new Error(`Hermes answered ${res.status}`)
	}
	return (await res.json()) as T
}

// ── Chats ────────────────────────────────────────────────────────────────────────────────────────

/** Bot Chats by session id, with their bot, learned from the live list. */
const botChats = new Map<string, string>()
/** Chats started through this relay, with their bot: a notice about them is one you asked for. */
const relayChats = new Map<string, string>()
const KEEP_CHATS = 500
const titles = new Map<string, string>()

async function nameOf(profile: string) {
	return (await botTitles()).get(profile) ?? (profile === 'default' ? 'Hermes' : profile)
}

/** Who a chat's notice is from and where it opens: a bot's chat opens the bot, any other chat itself. */
async function about(sessionId: string, profile: string) {
	let title = titles.get(sessionId)
	if (title === undefined && !botChats.has(sessionId)) {
		try {
			const r = await gw<{ session?: { title?: string | null }; title?: string | null }>(
				`${gwBase(profile)}/api/sessions/${encodeURIComponent(sessionId)}`,
			)
			title = (r.session ?? r).title ?? ''
			titles.set(sessionId, title)
		} catch {
			title = ''
		}
	}
	if (botChats.has(sessionId) || title === BOT_CHAT) return { ...botNotice(profile), title: await nameOf(profile) }
	// A bot's other chats open with the bot: the chat view finds them through it.
	if (profile !== 'default') return { ...botNotice(profile), title: title || (await nameOf(profile)) }
	return { ...chatNotice(sessionId), title: title || 'Chat' }
}

type Part = { type?: string; text?: string }
const textOf = (c: unknown) =>
	typeof c === 'string'
		? c
		: Array.isArray(c)
			? (c as Part[])
					.map((p) => (p?.type?.includes('text') ? (p.text ?? '') : ''))
					.filter(Boolean)
					.join('\n')
			: ''

/** The newest reply in a chat's transcript, for a notice's body. */
async function lastReply(sessionId: string, profile: string): Promise<string> {
	try {
		const r = await gw<{ data: Array<{ role: string; content: unknown }> }>(
			`${gwBase(profile)}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=6&order=latest`,
		)
		const list = r.data ?? []
		// Newest first when Hermes applied the order; an older backend answers oldest first.
		const ordered = (r as { order?: string }).order === 'latest' ? list : [...list].reverse()
		for (const m of ordered) if (m.role === 'assistant' && textOf(m.content).trim()) return textOf(m.content)
	} catch {}
	return ''
}

async function tellWaiting(sessionId: string, profile: string, detail?: string) {
	const a = await about(sessionId, profile)
	await notify({
		kind: 'waiting',
		tag: a.tag,
		route: a.route,
		title: a.title,
		body: detail ? `Wants to run: ${preview(detail, 140)}` : 'Waits for your approval or answer.',
	})
}

async function tellDone(sessionId: string, profile: string, text = '', error?: string) {
	const a = await about(sessionId, profile)
	const reply = error ? '' : preview(text || (await lastReply(sessionId, profile)))
	await notify({
		kind: 'reply',
		tag: a.tag,
		route: a.route,
		title: a.title,
		body: error ? `The turn failed: ${preview(error, 140)}` : reply || 'Replied.',
	})
}

onChatStream((news) => {
	if (news.type === 'started') {
		relayChats.delete(news.sessionId)
		relayChats.set(news.sessionId, news.profile)
		if (relayChats.size > KEEP_CHATS) relayChats.delete(relayChats.keys().next().value!)
		return
	}
	if (!wanted(news.type === 'approval' ? 'waiting' : 'reply')) return
	if (news.type === 'approval') void tellWaiting(news.sessionId, news.profile, news.detail)
	else if (news.status === 'completed') void tellDone(news.sessionId, news.profile, news.text)
	else if (news.status === 'failed') void tellDone(news.sessionId, news.profile, '', news.error ?? 'Hermes stopped it.')
})

/** Each bot's live chats at the last look. */
const liveSeen = new Map<string, LiveSeen>()
/**
 * While Hermes cannot be reached, looks thin out (up to every five minutes): each one would open the socket again,
 * and with a wrong dashboard login that is a login attempt every few seconds.
 */
let liveFailures = 0
let liveRestUntil = 0

async function lookAtLive() {
	if (!wanted('waiting') && !wanted('reply')) return void liveSeen.clear()
	if (Date.now() < liveRestUntil) return
	const names = [...(await botTitles()).keys()].filter((n) => n !== 'default')
	// Bots first: on some gateways a call for Hermes itself lists every bot's chats too, and a chat belongs to the bot
	// that listed it first.
	const owned = new Set<string>()
	let reached = false
	for (const profile of [...names, 'default']) {
		let rows: LiveRow[]
		try {
			rows = (await rpc<{ sessions?: LiveRow[] }>('session.active_list', scope(profile), 15_000)).sessions ?? []
			reached = true
		} catch (e) {
			const code = (e as { code?: unknown }).code
			if (!reached && ['no_ticket', 'socket_failed', 'socket_closed', 'not_configured'].includes(String(code))) break
			continue
		}
		rows = rows.filter((r) => r.id && !owned.has(r.id))
		for (const r of rows) {
			owned.add(r.id)
			if (r.title === BOT_CHAT) botChats.set(r.id, profile)
		}
		const { seen, changes } = liveChanges(liveSeen.get(profile), rows)
		liveSeen.set(profile, seen)
		for (const c of changes) {
			if (!botChats.has(c.id) && !relayChats.has(c.id)) continue
			if (c.change === 'waiting' && wanted('waiting')) void tellWaiting(c.id, profile)
			if (c.change === 'done' && wanted('reply')) void tellDone(c.id, profile)
		}
	}
	liveFailures = reached ? 0 : liveFailures + 1
	liveRestUntil = reached ? 0 : Date.now() + Math.min(5 * 60_000, POLL_MS * 2 ** liveFailures)
}

// ── Rooms ────────────────────────────────────────────────────────────────────────────────────────

type RoomState = {
	room: { room_id: string; name: string; latest_seq?: number; disbanded_at?: number | null }
	driver_status?: Parameters<typeof roomAsk>[1]
}
const ROOMS = { profile: 'default' }
/** What each room asked of you at the last look (its ask's key), or null for nothing. */
const roomSeen = new Map<string, string | null>()

async function lookAtRoom(roomId: string) {
	const st = await rpc<RoomState>('groups.state', { ...ROOMS, room_id: roomId })
	if (st.room.disbanded_at) return void roomSeen.delete(roomId)
	const latest = st.room.latest_seq ?? 0
	const page = await rpc<{ events: Parameters<typeof roomAsk>[0] }>('groups.log', {
		...ROOMS,
		room_id: roomId,
		since_seq: Math.max(0, latest - 20),
		limit: 40,
	})
	const ask = roomAsk(page.events ?? [], st.driver_status)
	const before = roomSeen.get(roomId)
	roomSeen.set(roomId, ask?.key ?? null)
	if (before === undefined || !ask || ask.key === before) return
	// Read already, on some device.
	if (ask.seq && (currentMarks().rooms[roomId] ?? 0) >= ask.seq) return
	await notify({
		kind: 'room',
		...roomNotice(roomId),
		title: st.room.name || 'Group chat',
		body: ask.approval
			? `A command waits for your approval${ask.text ? `: ${preview(ask.text, 140)}` : '.'}`
			: `${ask.who ? ask.who + ': ' : ''}${preview(ask.text)}`,
	})
}

async function lookAtRooms(ids?: string[]) {
	if (!wanted('room')) return void roomSeen.clear()
	if (!ids) {
		const all: string[] = []
		for (let offset = 0; ;) {
			const page = await rpc<{
				rooms: { room_id: string; disbanded_at?: number | null }[]
				next_offset: number | null
			}>('groups.list', { ...ROOMS, limit: 100, offset })
			all.push(...page.rooms.filter((r) => !r.disbanded_at).map((r) => r.room_id))
			if (page.next_offset === null || page.next_offset <= offset) break
			offset = page.next_offset
		}
		for (const id of roomSeen.keys()) if (!all.includes(id)) roomSeen.delete(id)
		ids = all
	}
	for (const id of ids) await lookAtRoom(id).catch(() => {})
}

// ── Schedules ────────────────────────────────────────────────────────────────────────────────────

const jobsSeen = new Map<string, Record<string, string>>()

/**
 * What a job's newest run produced: an agent run's last reply, or the start of a script's output (Hermes serves only
 * its first 180 characters, after a header that ends in `---`).
 */
async function runOutput(jobId: string, profile: string): Promise<string> {
	try {
		const scope = profile === 'default' ? '' : `&profile=${encodeURIComponent(profile)}`
		const r = await dash<{ runs?: { id?: string; source?: string; preview?: string }[] }>(
			`/api/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=1${scope}`,
		)
		const run = r.runs?.[0]
		if (run?.source === 'cron_output') {
			const text = String(run.preview ?? '')
			return text.startsWith('# Cron Job:') ? text.slice(text.indexOf('---') + 3).trim() : text
		}
		return run?.id ? await lastReply(run.id, profile) : ''
	} catch {
		return ''
	}
}

async function lookAtSchedules() {
	if (!wanted('schedule') && !wanted('scheduleRan')) return void jobsSeen.clear()
	for (const profile of ['default', ...connectedBots()]) {
		let jobs: JobLike[]
		try {
			jobs = (await gw<{ jobs: JobLike[] }>(`${gwBase(profile)}/api/jobs?include_disabled=true`)).jobs ?? []
		} catch {
			continue
		}
		const { seen, failed, ran } = finishedRuns(jobsSeen.get(profile), jobs)
		jobsSeen.set(profile, seen)
		const where = profile === 'default' ? '/schedules' : botNotice(profile).route
		if (wanted('scheduleRan'))
			for (const j of ran) {
				const bot = profile === 'default' ? '' : `${await nameOf(profile)}: `
				const output = preview(await runOutput(j.id, profile))
				await notify({
					kind: 'scheduleRan',
					tag: `schedule:${profile}:${j.id}`,
					route: where,
					title: `Schedule ran: ${j.name || 'Unnamed schedule'}`,
					body: bot + (output || 'Its run finished.'),
				})
			}
		for (const j of failed) {
			const bot = profile === 'default' ? '' : `${await nameOf(profile)}: `
			await notify({
				kind: 'schedule',
				tag: `schedule:${profile}:${j.id}`,
				route: where,
				title: `Schedule failed: ${j.name || 'Unnamed schedule'}`,
				body: bot + (j.last_error ? preview(j.last_error, 160) : 'Its last run ended in an error.'),
			})
		}
	}
}

// ── When to look ─────────────────────────────────────────────────────────────────────────────────

/** Run `look` now unless it already runs; a call while it runs makes it run once more after. */
function single(look: () => Promise<void>) {
	let running = false
	let again = false
	const run = async () => {
		if (running) return void (again = true)
		running = true
		try {
			await look()
		} catch {
			// Hermes is unreachable: the next look tries again.
		} finally {
			running = false
			if (again) {
				again = false
				void run()
			}
		}
	}
	return run
}

const live = single(lookAtLive)
const schedules = single(lookAtSchedules)
const allRooms = single(() => lookAtRooms())
let pendingRooms = new Set<string>()
let roomsTimer: ReturnType<typeof setTimeout> | undefined

function roomsMoved(ids: unknown) {
	if (!Array.isArray(ids)) return void allRooms()
	for (const id of ids) if (typeof id === 'string') pendingRooms.add(id)
	roomsTimer ??= setTimeout(() => {
		roomsTimer = undefined
		const batch = [...pendingRooms]
		pendingRooms = new Set()
		void lookAtRooms(batch).catch(() => {})
	}, 1000)
}

// Hermes' change events, heard only while notifications are wanted: listening keeps the socket open.
let unlisten: (() => void) | undefined
function listen() {
	if (!wanted()) return void (unlisten?.(), (unlisten = undefined))
	unlisten ??= onSocketEvent((e) => {
		if (e.type === 'groups.changed') roomsMoved(e.payload?.room_ids)
		else if (e.type === 'cron.changed') void schedules()
		else if (e.type === 'sessions.changed') void live()
	})
}

setInterval(() => {
	listen()
	void live()
}, POLL_MS)
setInterval(() => {
	void allRooms()
	void schedules()
}, SLOW_MS)
// The first looks learn how things stand, shortly after the relay starts.
setTimeout(() => {
	void live()
	void allRooms()
	void schedules()
}, 3000)
