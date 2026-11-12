import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { dashboard, type Profile } from '@/lib/dashboard'
import { BOT_CHAT_TITLE, gateway, gwFor, setSessionProfile, type Session } from '@/lib/gateway'
import { get, patch, post, del, qs } from '@/lib/http'
import { prettyToolName } from '@/lib/turns'
import type { BotLook, BotState } from '@/lib/avatar'
import { useSessions } from './sessions'

/** A bot's metadata as Hermes stores it (`ui_meta`, shared with Hermes Desktop), plus whether Caduceus holds its key. */
type BotMeta = {
	name: string
	title: string
	look: BotLook | null
	/** URL of the bot's picture, or a data URL right after picking one. */
	image: string | null
	hidden: boolean
	pinned: boolean
	sectionId: string | null
	sectionName: string | null
	connected: boolean
}

export type BotEdit = Partial<
	Pick<BotMeta, 'title' | 'look' | 'image' | 'hidden' | 'pinned' | 'sectionId' | 'sectionName'>
> & {
	description?: string
}

export type Bot = {
	/** The Hermes profile name, the bot's handle. */
	name: string
	/** How the bot is addressed: `@hermes` for the primary profile, `@<profile>` otherwise. */
	handle: string
	/** What the bot is called on screen: its title, else the profile's display name, else its name, prettified. */
	displayName: string
	/** The Bot Mode title, as Hermes Desktop names it. Empty when none is set. */
	title: string
	description: string
	model: string
	provider: string
	isDefault: boolean
	look: BotLook | null
	image: string | null
	/** Caduceus can chat with it: Hermes itself always, other bots once Caduceus holds their key. */
	connected: boolean
	skillCount: number
	/** Left out of the roster unless hidden bots are shown; still reachable by @mention. */
	hidden: boolean
	pinned: boolean
	/** The user-made section it is filed under, shared with Hermes Desktop. */
	sectionId: string | null
	sectionName: string | null
}

export type NewBot = {
	name: string
	title: string
	description: string
	look: BotLook
	image?: string | null
	cloneFrom: string
	noSkills?: boolean
	provider?: string
	model?: string
	soul?: string
}

const DONE_MS = 4000
const SECTIONS_KEY = 'caduceus.botSections'
const SEEN_KEY = 'caduceus.botSeen'

export type BotSection = { id: string; name: string }

function readJson<T>(key: string, fallback: T): T {
	try {
		return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
	} catch {
		return fallback
	}
}

/** `inbox-triage` reads as "Inbox Triage", as in Hermes Desktop. */
export function prettyName(name: string) {
	return name
		.replace(/[-_]+/g, ' ')
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase())
}

export const useBots = defineStore('bots', () => {
	const sessions = useSessions()
	const profiles = ref<Profile[]>([])
	const meta = ref<Record<string, BotMeta>>({})
	/** Each bot's `Bot Chat`, once found; `null` when it has none yet. */
	const chats = reactive<Record<string, Session | null>>({})
	const loaded = ref(false)
	const error = ref('')
	let inflight: Promise<void> | null = null

	const bots = computed<Bot[]>(() => {
		const out = profiles.value.map((p): Bot => {
			const m = meta.value[p.name]
			const isDefault = !!p.is_default || p.name === 'default'
			const title = (m?.title || p.bot_title || '').trim()
			return {
				name: p.name,
				handle: isDefault ? 'hermes' : p.name,
				// The same order Hermes Desktop uses, so a bot reads the same in both.
				displayName: title || p.display_name?.trim() || (isDefault ? 'Hermes' : prettyName(p.name)),
				title,
				description: p.description ?? '',
				model: p.model ?? '',
				provider: p.provider ?? '',
				isDefault,
				look: m?.look ?? null,
				image: m?.image ?? null,
				connected: isDefault || !!m?.connected,
				skillCount: p.skill_count ?? 0,
				hidden: !!m?.hidden,
				pinned: !!m?.pinned,
				sectionId: m?.sectionId ?? null,
				sectionName: m?.sectionName ?? null,
			}
		})
		const active = (b: Bot) => chats[b.name]?.last_active ?? chats[b.name]?.started_at ?? 0
		// Pinned first, then Hermes itself, then whoever spoke last.
		return out.sort(
			(a, b) =>
				+b.pinned - +a.pinned || +b.isDefault - +a.isDefault || active(b) - active(a) || a.name.localeCompare(b.name),
		)
	})

	function byName(name: string) {
		return bots.value.find((b) => b.name === name)
	}

	function load(): Promise<void> {
		inflight ??= (async () => {
			try {
				const [ps, ms] = await Promise.all([dashboard.profiles(), get<BotMeta[]>('ui-api/bots')])
				profiles.value = ps
				meta.value = Object.fromEntries(ms.map((m) => [m.name, m]))
				error.value = ''
				loaded.value = true
				await Promise.all(bots.value.filter((b) => b.connected).map((b) => findChat(b.name)))
			} catch (e) {
				error.value = (e as Error).message
			} finally {
				inflight = null
			}
		})()
		return inflight
	}

	function remember(name: string, s: Session) {
		setSessionProfile(s.id, name)
		chats[name] = s
		// Hermes' own Bot Chat is one of its chats and keeps its place in that list.
		if (name !== 'default') sessions.place(s, true)
	}

	async function findChat(name: string) {
		try {
			const s = await gateway.findBotChat(name)
			if (s) remember(name, s)
			else chats[name] = null
		} catch {
			// A bot whose chat cannot be listed shows without a preview; opening it reports the error.
		}
	}

	/** The id of a bot's `Bot Chat`, creating the chat on first use. */
	async function ensureChat(name: string): Promise<string> {
		const known = chats[name]
		if (known) return known.id
		const found = await gateway.findBotChat(name)
		const s = found ?? (await gateway.createBotChat(name))
		remember(name, s)
		return s.id
	}

	function chatId(name: string) {
		return chats[name]?.id
	}

	/** Which bot a session belongs to, if it is one of their chats. */
	function ownerOf(sessionId: string) {
		return Object.keys(chats).find((n) => chats[n]?.id === sessionId)
	}

	async function create(input: NewBot) {
		const m = await post<BotMeta>('ui-api/bots', input)
		meta.value = { ...meta.value, [m.name]: m }
		profiles.value = await dashboard.profiles()
		return m.name
	}

	async function saveMeta(name: string, body: BotEdit) {
		// Paint the change at once; the answer from Hermes replaces it.
		const before = meta.value[name]
		if (before) {
			const { description: _, ...shown } = body
			meta.value = { ...meta.value, [name]: { ...before, ...shown } }
		}
		try {
			const m = await patch<BotMeta>(`ui-api/bots/${encodeURIComponent(name)}`, body)
			meta.value = { ...meta.value, [name]: m }
		} catch (e) {
			if (before) meta.value = { ...meta.value, [name]: before }
			throw e
		}
	}

	async function update(name: string, changes: BotEdit & { soul?: string }) {
		const { soul, ...edit } = changes
		if (Object.keys(edit).length) await saveMeta(name, edit)
		const description = changes.description
		if (description !== undefined) await dashboard.setProfileDescription(name, description)
		if (soul !== undefined) await dashboard.setProfileSoul(name, soul)
		if (description !== undefined) profiles.value = await dashboard.profiles()
	}

	/** Give Caduceus the bot's gateway key. `replace` overwrites a key that another app set. */
	async function connect(name: string, replace = false) {
		const m = await post<BotMeta>(`ui-api/bots/${encodeURIComponent(name)}/connect`, { replace })
		meta.value = { ...meta.value, [name]: m }
		await findChat(name)
	}

	/**
	 * Compact a bot's Bot Chat: fresh working context, same conversation. Hermes may continue it under a new id
	 * (its compression tip), so the chat is looked up again afterwards.
	 */
	async function compact(name: string) {
		const id = chats[name]?.id
		if (!id) return null
		const r = await post<{ compressed: boolean; removed: number | null; message: string | null }>(
			`ui-api/bots/${encodeURIComponent(name)}/compact`,
			{ sessionId: id },
		)
		delete chats[name]
		await findChat(name)
		const next = chats[name]?.id
		if (next) await sessions.loadMessages(next, { quiet: true })
		return r
	}

	/** A full copy of a bot: config, skills, SOUL.md, memory and look, under a new handle. */
	async function duplicate(name: string, newName: string, title?: string) {
		const m = await post<BotMeta>(`ui-api/bots/${encodeURIComponent(name)}/duplicate`, { name: newName, title })
		meta.value = { ...meta.value, [m.name]: m }
		profiles.value = await dashboard.profiles()
		return m.name
	}

	// Sections: a bot's membership (id and name) lives in Hermes, so it follows the bot to every client; the list
	// of sections itself (order, empty ones) is kept per browser, as Hermes Desktop keeps it per desktop.
	const localSections = ref<BotSection[]>(readJson(SECTIONS_KEY, []))
	watch(localSections, (v) => localStorage.setItem(SECTIONS_KEY, JSON.stringify(v)), { deep: true })
	const sections = computed<BotSection[]>(() => {
		const out = [...localSections.value]
		for (const b of bots.value)
			if (b.sectionId && !out.some((s) => s.id === b.sectionId))
				out.push({ id: b.sectionId, name: b.sectionName || 'Section' })
		return out
	})

	function createSection(name: string): BotSection {
		const s = { id: `sec-${Math.random().toString(36).slice(2, 10)}`, name: name.trim() }
		localSections.value = [...localSections.value, s]
		return s
	}

	async function moveToSection(name: string, section: BotSection | null) {
		await saveMeta(name, { sectionId: section?.id ?? null, sectionName: section?.name ?? null })
	}

	async function renameSection(id: string, name: string) {
		const s = sections.value.find((x) => x.id === id)
		if (!s) return
		const renamed = { id, name: name.trim() }
		localSections.value = localSections.value.some((x) => x.id === id)
			? localSections.value.map((x) => (x.id === id ? renamed : x))
			: [...localSections.value, renamed]
		await Promise.all(bots.value.filter((b) => b.sectionId === id).map((b) => moveToSection(b.name, renamed)))
	}

	/** Deleting a section never deletes bots: its members go back to unassigned. Returns them, for undo. */
	async function deleteSection(id: string) {
		const members = bots.value.filter((b) => b.sectionId === id).map((b) => b.name)
		localSections.value = localSections.value.filter((x) => x.id !== id)
		await Promise.all(members.map((n) => moveToSection(n, null)))
		return members
	}

	function moveSection(id: string, by: -1 | 1) {
		const list = sections.value.slice()
		const i = list.findIndex((s) => s.id === id)
		const j = i + by
		if (i < 0 || j < 0 || j >= list.length) return
		;[list[i], list[j]] = [list[j]!, list[i]!]
		localSections.value = list
	}

	// Unread: a bot's chat moved since this browser last looked at it.
	const seen = ref<Record<string, number>>(readJson(SEEN_KEY, {}))
	watch(seen, (v) => localStorage.setItem(SEEN_KEY, JSON.stringify(v)), { deep: true })
	function lastActivity(name: string) {
		const c = chats[name]
		return Number(c?.last_active ?? c?.started_at ?? 0)
	}
	function unread(name: string) {
		const at = lastActivity(name)
		// Never seen: only count it once a conversation exists, and not for history from before Caduceus knew it.
		return at > 0 && seen.value[name] !== undefined && at > seen.value[name]!
	}
	function markSeen(name: string) {
		const at = Math.max(lastActivity(name), Date.now() / 1000)
		if ((seen.value[name] ?? 0) < at) seen.value = { ...seen.value, [name]: at }
	}
	// A bot this browser meets for the first time starts read.
	watch(
		() => bots.value.map((b) => b.name),
		(names) => {
			const missing = names.filter((n) => seen.value[n] === undefined)
			if (missing.length)
				seen.value = { ...seen.value, ...Object.fromEntries(missing.map((n) => [n, Date.now() / 1000])) }
		},
	)

	/** The bot's most recently active conversation other than its Bot Chat: a routine run, a delegated job. */
	async function recentSession(name: string): Promise<Session | undefined> {
		const r = await get<{ data: Session[] }>(`${gwFor(name)}/api/sessions${qs({ limit: 20 })}`)
		const s = r.data
			.filter((x) => x.title !== BOT_CHAT_TITLE && !x.archived)
			.sort((a, b) => Number(b.last_active ?? b.started_at ?? 0) - Number(a.last_active ?? a.started_at ?? 0))[0]
		if (s) {
			setSessionProfile(s.id, name)
			sessions.place(s, true)
		}
		return s
	}

	async function remove(name: string) {
		await del(`ui-api/bots/${encodeURIComponent(name)}`)
		profiles.value = profiles.value.filter((p) => p.name !== name)
		const { [name]: _, ...rest } = meta.value
		meta.value = rest
		delete chats[name]
	}

	// State, read off the bot's chat: what the face shows and the hover text says.
	function rawState(name: string): { state: BotState; hint?: string } {
		const id = chats[name]?.id
		if (!id) return { state: 'idle' }
		const l = sessions.live[id]
		if (l) {
			if (l.approval) return { state: 'waiting', hint: 'Waiting for your approval' }
			const last = l.turn.steps.at(-1)
			if (last?.kind === 'tool' && last.status === 'running')
				return { state: 'working', hint: `Running ${prettyToolName(last.name)}` }
			if (last?.kind === 'text') return { state: 'working', hint: 'Writing a reply' }
			// Thinking only while reasoning streams in: a Bot Chat's queued turn reports no steps until it ends.
			if (!last && l.turn.reasoning) return { state: 'thinking', hint: l.status ?? 'Thinking' }
			return { state: 'working', hint: l.status ?? 'Working' }
		}
		const r = sessions.remote[id]
		if (r) return r.approval ? { state: 'waiting', hint: 'Waiting for your approval' } : { state: 'working' }
		if (sessions.activeRuns[id]) return { state: 'working' }
		const err = sessions.lastError[id]
		if (err) return { state: 'blocked', hint: err }
		return { state: 'idle' }
	}

	// A bot that just finished smiles for a moment before it goes back to idle.
	const doneUntil = reactive<Record<string, number>>({})
	const busy = computed(() =>
		Object.fromEntries(
			bots.value.map((b) => {
				const s = rawState(b.name).state
				return [b.name, s === 'working' || s === 'thinking' || s === 'waiting']
			}),
		),
	)
	watch(busy, (now, before) => {
		for (const name of Object.keys(before ?? {})) {
			if (!before[name] || now[name] || rawState(name).state === 'blocked') continue
			doneUntil[name] = Date.now() + DONE_MS
			setTimeout(() => {
				if ((doneUntil[name] ?? 0) <= Date.now()) delete doneUntil[name]
			}, DONE_MS)
		}
	})

	function stateOf(name: string): { state: BotState; hint?: string } {
		const s = rawState(name)
		if (s.state === 'idle' && doneUntil[name]) return { state: 'done', hint: 'Done' }
		return s
	}

	return {
		bots,
		chats,
		loaded,
		error,
		load,
		byName,
		ensureChat,
		findChat,
		chatId,
		ownerOf,
		create,
		update,
		saveMeta,
		duplicate,
		compact,
		sections,
		createSection,
		moveToSection,
		renameSection,
		deleteSection,
		moveSection,
		unread,
		markSeen,
		recentSession,
		connect,
		remove,
		stateOf,
	}
})
