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

export const EVENT_KINDS = ['waiting', 'reply', 'room', 'schedule'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const EVENT_LABELS: Record<EventKind, { label: string; hint: string }> = {
	waiting: { label: 'A bot waits for you', hint: 'A command waits for your approval, or a bot asks you a question.' },
	reply: { label: 'A reply is ready', hint: "A bot's chat, or a chat you started here, finished its turn." },
	room: { label: 'A group chat needs you', hint: 'A bot hands something to you with @user, or asks for an approval.' },
	schedule: { label: 'A schedule failed', hint: "A scheduled job's last run ended in an error." },
}

export type Notice = {
	kind: EventKind
	tag: string
	title: string
	body: string
	/** The app route that opens it, e.g. `/bots/ada`. */
	route: string
}

export type Target = { kind: 'ntfy'; url: string; token?: string } | { kind: 'webhook'; url: string }

export type NotifyConfig = {
	events: Record<EventKind, boolean>
	/** While you use Caduceus on one device, no other device or channel is told. */
	quietWhileActive: boolean
	/** Channels besides the devices: an ntfy topic, or a webhook that gets each notice as JSON. */
	targets: Target[]
}

export const defaultConfig = (): NotifyConfig => ({
	events: { waiting: true, reply: true, room: true, schedule: true },
	quietWhileActive: true,
	targets: [],
})

const isUrl = (v: unknown): v is string => {
	if (typeof v !== 'string') return false
	try {
		return ['http:', 'https:'].includes(new URL(v).protocol)
	} catch {
		return false
	}
}

/** One channel from outside (a request body, a stored file), or why it is not one. */
export function parseTarget(v: unknown): Target | string {
	const t = v as Record<string, unknown> | null
	if (!t || typeof t !== 'object') return 'A channel must be an object.'
	if (!isUrl(t.url)) return 'A channel needs an http or https address.'
	if (t.kind === 'webhook') return { kind: 'webhook', url: t.url }
	if (t.kind === 'ntfy') {
		const token = typeof t.token === 'string' && t.token.trim() ? t.token.trim() : undefined
		return token ? { kind: 'ntfy', url: t.url, token } : { kind: 'ntfy', url: t.url }
	}
	return `Unknown kind of channel "${String(t.kind)}".`
}

/** A config patch from outside, taken onto `base`, or why it cannot be. */
export function parseConfig(v: unknown, base: NotifyConfig = defaultConfig()): NotifyConfig | string {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Notification settings must be an object.'
	const p = v as Record<string, unknown>
	const out: NotifyConfig = {
		events: { ...base.events },
		quietWhileActive: base.quietWhileActive,
		targets: base.targets,
	}
	for (const k of Object.keys(p))
		if (!['events', 'quietWhileActive', 'targets'].includes(k)) return `Unknown notification setting "${k}".`
	if (p.events !== undefined) {
		if (!p.events || typeof p.events !== 'object') return 'events must be an object.'
		for (const [k, on] of Object.entries(p.events)) {
			if (!(EVENT_KINDS as readonly string[]).includes(k)) return `Unknown kind of notification "${k}".`
			if (typeof on !== 'boolean') return `events.${k} must be true or false.`
			out.events[k as EventKind] = on
		}
	}
	if (p.quietWhileActive !== undefined) {
		if (typeof p.quietWhileActive !== 'boolean') return 'quietWhileActive must be true or false.'
		out.quietWhileActive = p.quietWhileActive
	}
	if (p.targets !== undefined) {
		if (!Array.isArray(p.targets)) return 'targets must be a list.'
		const targets: Target[] = []
		for (const t of p.targets) {
			const parsed = parseTarget(t)
			if (typeof parsed === 'string') return parsed
			targets.push(parsed)
		}
		out.targets = targets
	}
	return out
}

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

/** Jobs whose last run is new since the last look and failed. The first look only learns the runs. */
export function failedRuns(
	before: Record<string, string> | undefined,
	jobs: readonly JobLike[],
): { seen: Record<string, string>; failed: JobLike[] } {
	const seen: Record<string, string> = {}
	for (const j of jobs) seen[j.id] = `${j.last_run_at ?? ''}|${j.last_status ?? ''}`
	if (!before) return { seen, failed: [] }
	return { seen, failed: jobs.filter((j) => j.last_run_at && seen[j.id] !== before[j.id] && runFailed(j.last_status)) }
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
