/**
 * Notifications: what Caduceus tells you about while you are away. The relay watches Hermes
 * (`server/notify-watch.ts`), turns what it sees into notices with the rules here, and delivers them
 * (`server/notify.ts`) to the devices that turned notifications on and to the channels set on the server (ntfy,
 * webhooks). The server, the browser and the tests share this module.
 *
 * A notice's `tag` names what it is about (`bot:<name>`, `chat:<session id>`, `room:<room id>`,
 * `schedule:<job id>`). A newer notice replaces the older one with the same tag on a device, reading that chat
 * clears it, and a device showing that chat gets none for it.
 */

import { Type, type Static } from '@sinclair/typebox'
import { withoutDefaults } from './schema'

export const EVENT_KINDS = ['waiting', 'reply', 'room', 'schedule', 'scheduleRan'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const EVENT_LABELS: Record<EventKind, { label: string; hint: string }> = {
	waiting: { label: 'A bot waits for you', hint: 'A command waits for your approval, or a bot asks you a question.' },
	reply: { label: 'A reply is ready', hint: "A bot's chat, or a chat you started here, finished its turn." },
	room: { label: 'A group chat needs you', hint: 'A bot hands something to you with @user, or asks for an approval.' },
	schedule: { label: 'A schedule failed', hint: "A scheduled job's last run ended in an error." },
	scheduleRan: {
		label: 'A schedule ran',
		hint: 'A scheduled job finished, with the start of what it produced. Off at first: schedules may run often.',
	},
}

export type Notice = {
	kind: EventKind
	tag: string
	title: string
	body: string
	/** The app route that opens it, e.g. `/bots/ada`. */
	route: string
}

const Address = Type.String({ pattern: '^https?://[^\\s]+$', description: 'An http or https address.' })

export const ChannelSchema = Type.Union(
	[
		Type.Object(
			{ kind: Type.Literal('ntfy'), url: Address, token: Type.Optional(Type.String({ minLength: 1 })) },
			{ additionalProperties: false },
		),
		Type.Object({ kind: Type.Literal('webhook'), url: Address }, { additionalProperties: false }),
	],
	{ error: 'A channel is an ntfy topic or a webhook with an http or https address.' },
)
/** Somewhere besides your devices that gets every notice: an ntfy topic, or a webhook that gets it as JSON. */
export type Channel = Static<typeof ChannelSchema>

export const NotifySettingsSchema = Type.Object(
	{
		events: Type.Object(
			{
				waiting: Type.Boolean({ default: true }),
				reply: Type.Boolean({ default: true }),
				room: Type.Boolean({ default: true }),
				schedule: Type.Boolean({ default: true }),
				scheduleRan: Type.Boolean({ default: false }),
			},
			{ additionalProperties: false, default: {} },
		),
		/** While you use Caduceus on one device, no other device or channel is told. */
		quietWhileActive: Type.Boolean({ default: true }),
		channels: Type.Array(ChannelSchema, { default: [] }),
	},
	{ additionalProperties: false, default: {} },
)
export type NotifySettings = Static<typeof NotifySettingsSchema>

/** A change to some of them; `events` may name only the kinds that change. */
export const NotifyPatchSchema = Type.Object(
	{
		events: Type.Optional(
			Type.Partial(withoutDefaults(NotifySettingsSchema.properties.events), { additionalProperties: false }),
		),
		quietWhileActive: Type.Optional(Type.Boolean()),
		channels: Type.Optional(withoutDefaults(NotifySettingsSchema.properties.channels)),
		/** Caduceus's address as the browser sees it, for links in channel messages. */
		appUrl: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
)
export type NotifyPatch = Static<typeof NotifyPatchSchema>

// ── Tags and routes ──────────────────────────────────────────────────────────────────────────────

/** A bot's Bot Chat is Hermes' session with this title. */
export const BOT_CHAT = 'Bot Chat'

export const botNotice = (name: string) => ({ tag: `bot:${name}`, route: `/bots/${encodeURIComponent(name)}` })
export const chatNotice = (id: string) => ({ tag: `chat:${id}`, route: `/chat/${encodeURIComponent(id)}` })
export const roomNotice = (id: string) => ({ tag: `room:${id}`, route: `/bots/rooms/${encodeURIComponent(id)}` })

/** The tag of what a route shows, so that a device showing it gets no notice for it and opening it clears them. */
export function tagOfRoute(path: string): string | null {
	const parts = path.split('?')[0]!.split('/').filter(Boolean).map(decodeURIComponent)
	const [a, b, c] = parts
	if ((a === 'bots' || a === 'chat') && (b === 'rooms' || b === 'room') && c) return `room:${c}`
	if (a === 'chat' && b === 'bot' && c) return `bot:${c}`
	if (a === 'bots' && b && b !== 'rooms') return `bot:${b}`
	if (a === 'chat' && b && b !== 'bot' && b !== 'room') return `chat:${b}`
	return null
}

/** The tag a read mark clears: reading a bot's chat or a room on any device clears its notices on all. */
export const tagOfMark = (kind: 'bots' | 'rooms', key: string) => (kind === 'bots' ? `bot:${key}` : `room:${key}`)

// ── Live sessions: a turn waiting for you, a turn done ─────────────────────────────────────────────

/** A row of Hermes' `session.active_list`. */
export type LiveRow = { id: string; status: string; title?: string; source?: string | null }
/** The status of each live session at the last look. */
export type LiveSeen = Record<string, string>
export type LiveChange = { id: string; change: 'waiting' | 'done' }

const BUSY = new Set(['working', 'waiting', 'starting'])

/**
 * What moved since the last look. A turn that starts waiting (an approval, a question) is news once; a turn that was
 * busy and is not any more (idle, or gone from the list) is done. The first look only learns what runs.
 */
export function liveChanges(before: LiveSeen | undefined, rows: LiveRow[]): { seen: LiveSeen; changes: LiveChange[] } {
	const seen: LiveSeen = {}
	for (const r of rows) seen[r.id] = r.status
	if (!before) return { seen, changes: [] }
	const changes: LiveChange[] = []
	for (const r of rows) {
		const was = before[r.id]
		if (r.status === 'waiting' && was !== 'waiting') changes.push({ id: r.id, change: 'waiting' })
		else if (was && BUSY.has(was) && !BUSY.has(r.status)) changes.push({ id: r.id, change: 'done' })
	}
	for (const [id, was] of Object.entries(before))
		if (!(id in seen) && BUSY.has(was)) changes.push({ id, change: 'done' })
	return { seen, changes }
}

// ── Rooms: a bot hands something to you ───────────────────────────────────────────────────────────

type RoomEventLike = {
	seq: number
	kind: string
	payload: Record<string, any>
	actor?: { display_name?: string; profile?: string }
}
type RoomStatusLike = {
	pending_actions?: Array<{
		kind: string
		task_id: string
		execution_generation: number
		approval?: { command?: string; description?: string }
	}>
} | null

export type RoomAsk = { key: string; seq?: number; who?: string; text: string; approval: boolean }

/**
 * What a room asks of you right now: a command waiting for approval, or a bot's `@user` after your last message.
 * Its `key` changes with each new ask, so the same one is never news twice.
 */
export function roomAsk(events: readonly RoomEventLike[], status: RoomStatusLike | undefined): RoomAsk | null {
	const approval = status?.pending_actions?.find((a) => a.kind === 'approval')
	if (approval)
		return {
			key: `approval:${approval.task_id}:${approval.execution_generation}`,
			text: approval.approval?.command ?? approval.approval?.description ?? '',
			approval: true,
		}
	let lastUser = 0
	let ask: RoomEventLike | undefined
	for (const e of events) {
		if (e.kind === 'message.user') lastUser = e.seq
		if (e.kind === 'message.member' && /(^|\s)@user\b/i.test(String(e.payload.text ?? ''))) ask = e
	}
	if (!ask || ask.seq <= lastUser) return null
	return {
		key: `ask:${ask.seq}`,
		seq: ask.seq,
		who: ask.actor?.display_name ?? ask.actor?.profile,
		text: String(ask.payload.text ?? ''),
		approval: false,
	}
}

// ── Schedules: a run that failed ─────────────────────────────────────────────────────────────────

export type JobLike = {
	id: string
	name?: string
	last_run_at?: string | null
	last_status?: string | null
	last_error?: string | null
}

/** Hermes stamps `ok`, `error`, `delivery_failed` or `cancelled`; a stop by hand is not a failure. */
export const runFailed = (status: string | null | undefined) =>
	!!status && (status === 'error' || status.includes('fail'))

/**
 * Jobs whose last run is new since the last look: those that failed, and those that went well (`ok`). A run still
 * delivering (`delivery_queued`) is news only once it settles, and one stopped by hand is none. The first look only
 * learns the runs.
 */
export function finishedRuns(
	before: Record<string, string> | undefined,
	jobs: readonly JobLike[],
): { seen: Record<string, string>; failed: JobLike[]; ran: JobLike[] } {
	const seen: Record<string, string> = {}
	for (const j of jobs) seen[j.id] = `${j.last_run_at ?? ''}|${j.last_status ?? ''}`
	if (!before) return { seen, failed: [], ran: [] }
	const fresh = jobs.filter((j) => j.last_run_at && seen[j.id] !== before[j.id])
	return {
		seen,
		failed: fresh.filter((j) => runFailed(j.last_status)),
		ran: fresh.filter((j) => j.last_status === 'ok'),
	}
}

// ── Who is told ──────────────────────────────────────────────────────────────────────────────────

/** A device in use right now: shown, focused, touched lately. It says so every half minute while it is. */
export type Presence = { device: string; viewing: string | null; at: number }

export const PRESENCE_MS = 70_000

export function activeDevices(presence: Iterable<Presence>, now: number): Presence[] {
	return [...presence].filter((p) => now - p.at < PRESENCE_MS)
}

/**
 * Whether a notice goes out at all, and to which devices. Nobody is told about the chat they are looking at, a device
 * in use learns the news in the app itself, and with `quietWhileActive` nobody is told while you use Caduceus.
 */
export function audience(
	notice: Pick<Notice, 'tag'>,
	active: readonly Presence[],
	quietWhileActive: boolean,
): { send: boolean; skipDevices: Set<string> } {
	const skipDevices = new Set(active.map((p) => p.device))
	if (active.some((p) => p.viewing === notice.tag)) return { send: false, skipDevices }
	if (quietWhileActive && active.length) return { send: false, skipDevices }
	return { send: true, skipDevices }
}

/** Shorten text for a notification body: one paragraph of plain words, without Markdown's marks. */
export function preview(text: string, max = 180): string {
	const plain = text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`#>|]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}
