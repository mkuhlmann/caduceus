import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import {
	BOT_CHAT_TITLE,
	contentText,
	gateway,
	pendingApproval,
	pendingClarify,
	sessionProfile,
	type ApprovalRequest,
	type ClarifyPrompt,
	type Message,
	type Session,
} from '@/lib/gateway'
import {
	APPROVAL_CHOICES,
	type AgentTurn,
	type ApprovalStep,
	type ClarifyStep,
	type Step,
	type Turn,
} from '@/lib/turns'
import {
	lastReplyKey,
	liveTurns,
	newestId,
	savedProgress,
	startId,
	turnStartHeld,
	type LiveTail,
} from '@/lib/live-tail'
import { useToasts } from './toast'
import { useProjects } from './projects'
import { forgetTranscript, readTranscript, saveTranscript } from '@/lib/transcript-cache'
import { fetchOlder, fetchTail, LIVE_TAIL, mergeTail, prependOlder, TAIL, type Tail } from '@/lib/transcript-pages'
import { onRpcEvent } from '@/lib/rpc'
import { onResync } from '@/lib/live'
import { watchBotChat, type BotChatWatch, type WatchEvent } from '@/lib/bot-watch'
import { post } from '@/lib/http'
import { TurnWriter } from '@/lib/turn-writer'
import { counters, RunClock, savedStats, saveStats, turnStats, turnTokens, type RunStats } from '@/lib/run-stats'
import { useApp } from './app'
import { usePreferences } from './preferences'

type Live = {
	runId?: string
	turn: AgentTurn
	user: { text: string; images: string[] }
	abort: AbortController
	status?: string
	stopRequested?: boolean
	/** The newest message held when it was sent. Saved ones after it are this turn's, shown live instead. */
	after?: number
}

/** A run of the open session that this tab did not start: another tab, device or channel. */
type Remote = { runId?: string; approval?: ApprovalRequest; clarify?: ClarifyPrompt[] }

const FOLLOW_MS = 2000
const IDLE_MS = 6000
// A transcript that stopped mid-turn longer ago than this is an interrupted run, not a live one.
const STALE_S = 10 * 60
const RUNS_MS = 4000
// How often a run is asked for its clarify questions while the agent's clarify tool runs. The chat stream does not
// carry them; the run's status does.
const CLARIFY_MS = 1000
// How often a Bot Chat's saved steps are read while the bot works.
const SAVED_MS = 1500
// How often a Bot Chat's turn looks for the saved message that began it.
const START_MS = 1000
// Hermes titles a chat instantly from the first message, then upgrades it with a model in the background,
// often after the run has ended. Look again a few times so the better title shows up.
const TITLE_CHECKS_MS = [4000, 12000, 30000]
// Conversations kept in memory so going back to one paints it at once.
const KEEP_TRANSCRIPTS = 16
// The newest chats are saved locally so a cold start paints the list before the gateway answers.
const LIST_KEY = 'caduceus.sessionList'
const LIST_SAVED = 40

type SavedList = { items: Session[]; hasMore: boolean }

function readSavedList(): SavedList | null {
	try {
		const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null')
		return v && Array.isArray(v.items) ? v : null
	} catch {
		return null
	}
}

function saveList(items: Session[], hasMore: boolean) {
	const slim = items.slice(0, LIST_SAVED).map((s) => ({
		id: s.id,
		source: s.source,
		title: s.title,
		preview: s.preview?.slice(0, 80),
		started_at: s.started_at,
		last_active: s.last_active,
		pinned: s.pinned,
		archived: s.archived,
		hidden: s.hidden,
	}))
	try {
		localStorage.setItem(LIST_KEY, JSON.stringify({ items: slim, hasMore: hasMore || items.length > LIST_SAVED }))
	} catch {
		// Storage full or blocked: the list just loads from the network next time.
	}
}

function clarifyStep(q: ClarifyPrompt, via: ClarifyStep['via']): ClarifyStep {
	return { kind: 'clarify', id: q.id, question: q.question, choices: q.choices, multiSelect: q.multiSelect, via }
}

// Tries at picking up a dropped reply stream while the app is shown, a little further apart each time.
const REJOIN_TRIES = 8

/** The connection dropped (not a refusal): picking the stream up again may work. */
function dropped(e: unknown) {
	const err = e as Error & { status?: number }
	return err.name === 'StreamLost' || (err.name === 'TypeError' && err.status === undefined)
}

/** Wait before picking a dropped stream up again: until the app is shown, then a moment, or until back online. */
function backAgain(tries: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const delay = Math.min(10_000, 500 * 2 ** (tries - 1))
		let timer: ReturnType<typeof setTimeout> | undefined
		const done = () => {
			clearTimeout(timer)
			document.removeEventListener('visibilitychange', shown)
			removeEventListener('online', done)
			signal.removeEventListener('abort', done)
			resolve()
		}
		// A phone asleep is not a try: the wait starts once the app is shown again.
		const shown = () => {
			clearTimeout(timer)
			if (!document.hidden) timer = setTimeout(done, delay)
		}
		document.addEventListener('visibilitychange', shown)
		addEventListener('online', done)
		signal.addEventListener('abort', done)
		shown()
	})
}

function lastOf<T>(xs: T[], ok: (x: T) => unknown) {
	for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i]!)) return xs[i]
}

function unfinished(ms: Message[]) {
	const last = lastOf(ms, (m) => m.role !== 'system' && m.display_kind !== 'hidden')
	if (!last) return false
	return last.role === 'user' || last.role === 'tool' || (last.role === 'assistant' && !!last.tool_calls?.length)
}

function sameTranscript(a: Message[] | undefined, b: Message[]) {
	if (!a || a.length !== b.length) return false
	const x = a.at(-1)
	const y = b.at(-1)
	return x?.id === y?.id && JSON.stringify(x?.content) === JSON.stringify(y?.content)
}

export const SOURCE_LABELS: Record<string, string> = {
	api_server: 'Caduceus',
	cli: 'Terminal',
	tui: 'Terminal',
	telegram: 'Telegram',
	discord: 'Discord',
	slack: 'Slack',
	matrix: 'Matrix',
	signal: 'Signal',
	whatsapp: 'WhatsApp',
	email: 'Email',
	cron: 'Schedule',
	webhook: 'Webhook',
	homeassistant: 'Home Assistant',
	kanban: 'Board',
	dashboard: 'Dashboard',
	desktop: 'Desktop',
	local: 'Local',
	oneshot: 'One-off run',
	webui: 'Web UI',
}

export function sourceLabel(s?: string) {
	if (!s) return ''
	const label = SOURCE_LABELS[s] ?? s.replace(/_/g, ' ')
	return label.charAt(0).toUpperCase() + label.slice(1)
}

export const useSessions = defineStore('sessions', () => {
	const toasts = useToasts()
	const saved = readSavedList()
	const list = ref<Session[]>(saved?.items ?? [])
	const hasMore = ref(saved?.hasMore ?? false)
	const loadingList = ref(false)
	const listError = ref('')
	const showScheduled = ref(localStorage.getItem('caduceus.showScheduled') === '1')

	// Shallow: transcripts are replaced whole, and deep proxies would make every render walk them.
	const messages = shallowReactive<Record<string, Message[]>>({})
	const loading = reactive<Record<string, boolean>>({})
	// A chat on screen from memory or disk while a fresh copy loads, and one whose fresh copy failed to load.
	const refreshing = reactive<Record<string, boolean>>({})
	const refreshError = reactive<Record<string, string>>({})
	// Transcripts read from disk without their inline images: the network copy always replaces them.
	const partial = new WeakSet<Message[]>()
	// Chats with messages on the server older than the ones held, and those loading such a page now.
	const older = reactive<Record<string, boolean>>({})
	const loadingOlder = reactive<Record<string, boolean>>({})
	const inflight = new Map<string, Promise<void>>()
	const recent: string[] = []
	const live = reactive<Record<string, Live>>({})
	const lastError = shallowRef<Record<string, string>>({})
	const remote = reactive<Record<string, Remote>>({})
	const activeRuns = ref<Record<string, string>>({})
	// Bots' conversations: kept apart so they never show up among Hermes' own chats.
	const botSessions = reactive<Record<string, Session>>({})
	// Speed of replies streamed in this browser, by `<session>:<turn key>`.
	const runStats = shallowRef<Record<string, RunStats>>(savedStats())

	/** Add a session fetched by id to the list it belongs to; moved to the top unless `inPlace`. */
	function place(s: Session, inPlace = false) {
		if (sessionProfile(s.id)) {
			botSessions[s.id] = s
			return
		}
		const i = list.value.findIndex((x) => x.id === s.id)
		if (inPlace && i >= 0) list.value.splice(i, 1, s)
		else {
			if (i >= 0) list.value.splice(i, 1)
			list.value.unshift(s)
		}
	}

	async function loadList(more = false) {
		loadingList.value = true
		listError.value = ''
		try {
			const r = await gateway.sessions({ limit: 60, offset: more ? list.value.length : 0 })
			const merged = more
				? [...list.value, ...r.data]
				: [...r.data, ...list.value.filter((x) => !r.data.some((y) => y.id === x.id) && live[x.id])]
			const seen = new Set<string>()
			list.value = merged.filter((s) => !seen.has(s.id) && !!seen.add(s.id))
			hasMore.value = r.has_more
			listFresh = true
		} catch (e) {
			listError.value = (e as Error).message
		} finally {
			loadingList.value = false
		}
	}

	/**
	 * Read the newest page of chats again, keeping older pages already shown: a chat started, renamed or deleted on
	 * another device shows here too.
	 */
	async function refreshList() {
		if (!listFresh || loadingList.value) return
		try {
			const r = await gateway.sessions({ limit: 60 })
			const ids = new Set(r.data.map((s) => s.id))
			const oldest = Math.min(...r.data.map((s) => s.last_active ?? s.started_at ?? Infinity))
			// Kept: the open one, the ones running from here, Hermes' Bot Chat (hidden from the list's first page), and
			// those from older pages, below the newest page.
			const keep = (x: Session) =>
				x.id === followed ||
				live[x.id] ||
				x.title === BOT_CHAT_TITLE ||
				(r.has_more && (x.last_active ?? x.started_at ?? 0) < oldest)
			const rest = list.value.filter((x) => !ids.has(x.id) && keep(x))
			list.value = [...r.data, ...rest]
		} catch {
			// The list on screen stays; the next change or return reads it again.
		}
	}

	let listFresh = false
	// A list painted from local storage is refreshed once, whichever view asked for the store first.
	if (saved) void loadList()
	/** Load the list unless this app session already has a fresh one. */
	function ensureList() {
		if (!listFresh && !loadingList.value) void loadList()
	}
	let saveTimer: ReturnType<typeof setTimeout> | undefined
	watch(
		[list, hasMore],
		() => {
			clearTimeout(saveTimer)
			saveTimer = setTimeout(() => listFresh && saveList(list.value, hasMore.value), 800)
		},
		{ deep: true },
	)

	const visible = computed(() =>
		list.value.filter((s) => !s.hidden && !s.archived && (showScheduled.value || s.source !== 'cron')),
	)

	function setShowScheduled(v: boolean) {
		showScheduled.value = v
		localStorage.setItem('caduceus.showScheduled', v ? '1' : '0')
	}

	function byId(id: string): Session | undefined {
		return list.value.find((s) => s.id === id) ?? botSessions[id]
	}

	/** Remember `id` as recently viewed and drop the transcripts of chats not looked at for a while. */
	function touch(id: string) {
		const i = recent.indexOf(id)
		if (i >= 0) recent.splice(i, 1)
		recent.unshift(id)
		for (const old of recent.splice(KEEP_TRANSCRIPTS)) {
			if (live[old] || old === followed) recent.push(old)
			else delete messages[old]
		}
	}

	/** Save the newest page of a chat to disk; older pages come from the server when scrolled to. */
	function save(id: string) {
		const ms = messages[id]
		if (ms) saveTranscript(id, ms.slice(-TAIL), !!older[id] || ms.length > TAIL)
	}

	/** Lay a fresh newest page over the chat. False when it does not meet the messages held. */
	function applyTail(id: string, tail: Tail): boolean {
		const current = messages[id]
		const merged = mergeTail(current, tail.ms, !tail.more)
		if (!merged) return false
		if (merged === tail.ms) older[id] = tail.more
		delete refreshError[id]
		// Keep the same array when nothing changed, so nothing re-renders.
		if (current && !partial.has(current) && sameTranscript(current, merged)) return true
		messages[id] = merged
		save(id)
		return true
	}

	/**
	 * Bring a chat up to date by reading its newest messages. `ok` is asked again once they arrive, so a
	 * chat that started streaming here or was closed meanwhile is left alone.
	 */
	async function refreshTail(id: string, { limit = TAIL, ok = (): boolean => true } = {}) {
		let tail = await fetchTail(id, limit)
		if (!ok() || applyTail(id, tail)) return
		if (limit < TAIL) {
			tail = await fetchTail(id, TAIL)
			if (!ok() || applyTail(id, tail)) return
		}
		// More was written since this chat was last read than a page holds: start again from its end.
		messages[id] = tail.ms
		older[id] = tail.more
		save(id)
	}

	/** Paint a chat from its copy on disk, if it is not in memory yet. */
	async function fromDisk(id: string) {
		if (messages[id]) return
		const saved = await readTranscript(id)
		if (!saved || messages[id]) return
		if (saved.partial) partial.add(saved.messages)
		messages[id] = saved.messages
		older[id] = saved.more
		touch(id)
	}

	/** Load the page of messages before the earliest one held, as the reader scrolls up to it. */
	async function loadOlder(id: string) {
		const held = messages[id]
		if (!held?.length || !older[id] || loadingOlder[id]) return
		loadingOlder[id] = true
		try {
			const page = await fetchOlder(id, held.length)
			const now = messages[id]
			if (!now) return
			const merged = prependOlder(now, page.ms)
			// The page held only messages already here: so much was written since the last read that the
			// offset no longer reaches back. Catch up with the end first; the next scroll continues from there.
			if (merged === now && page.more) return void (await refreshTail(id))
			messages[id] = merged
			older[id] = page.more
		} catch (e) {
			toasts.error(`Could not load earlier messages: ${(e as Error).message}`)
		} finally {
			delete loadingOlder[id]
		}
	}

	/**
	 * Fetch a transcript; concurrent calls for the same chat share one request. A saved copy shows first.
	 * `open` is the chat on screen: its refresh shows as such, and a failed one keeps the copy with a note
	 * instead of a toast. `quiet` loads never report failure.
	 */
	function loadMessages(id: string, opts: { quiet?: boolean; open?: boolean } = {}): Promise<void> {
		const running = inflight.get(id)
		if (running) {
			if (opts.open && messages[id]) refreshing[id] = true
			return running
		}
		loading[id] = true
		const p = (async () => {
			try {
				await fromDisk(id)
				if (opts.open && messages[id]) refreshing[id] = true
				await refreshTail(id)
				touch(id)
				if (!byId(id)) {
					const s = await gateway.session(id).catch(() => null)
					if (s && !byId(id)) place(s)
				}
			} catch (e) {
				const msg = (e as Error).message
				// Deleted elsewhere: the saved copy is of a chat that no longer exists.
				if ((e as { status?: number }).status === 404 && !live[id]) {
					delete messages[id]
					void forgetTranscript(id)
				}
				if (refreshing[id] && messages[id]) refreshError[id] = msg
				else if (!opts.quiet) toasts.error(`Could not load this conversation: ${msg}`)
			} finally {
				delete loading[id]
				delete refreshing[id]
				inflight.delete(id)
			}
		})()
		inflight.set(id, p)
		return p
	}

	/** Warm the cache for a chat the user is about to open (hover or touch on its row). */
	function prefetch(id: string) {
		if (!messages[id] && !live[id]) void loadMessages(id, { quiet: true })
	}

	/** Read the newest chats' saved copies into memory once the app is idle, so the first click paints at once. */
	setTimeout(() => {
		for (const s of list.value.filter((s) => !s.hidden && !s.archived).slice(0, 5)) void fromDisk(s.id)
	}, 1500)

	function hasTranscript(id: string) {
		return !!messages[id]
	}

	function isLoading(id: string) {
		return !!loading[id]
	}

	function isRefreshing(id: string) {
		return !!refreshing[id]
	}

	/** The server has messages of this chat older than the ones held. */
	function hasOlder(id: string) {
		return !!older[id]
	}

	function isLoadingOlder(id: string) {
		return !!loadingOlder[id]
	}

	function turnsFor(id: string): Turn[] {
		return liveTurns(messages[id] ?? [], tailOf(id), { older: !!older[id] })
	}

	/** The running turn as the transcript shows it after its saved messages. */
	function tailOf(id: string): LiveTail | undefined {
		const l = live[id]
		if (l) return { kind: 'sent', turn: l.turn, user: l.user, after: l.after }
		const bt = botTurns[id]
		if (bt) return { kind: 'watched', turn: bt.turn, after: bt.after }
		const r = remote[id]
		if (!r) return undefined
		const waiting: Step[] = []
		const a = r.approval
		if (a)
			waiting.push({
				kind: 'approval',
				command: a.command,
				description: a.description,
				choices: a.choices ?? APPROVAL_CHOICES,
				via: { run: a },
			})
		if (r.runId)
			for (const q of r.clarify ?? []) waiting.push(clarifyStep(q, { run: r.runId, generation: q.generation }))
		return { kind: 'followed', waiting }
	}

	/** What the run in this chat waits for from you: a decision on an approval, or an answer to a question. */
	function waitingOn(id: string): 'approval' | 'answer' | undefined {
		const tail = tailOf(id)
		if (!tail) return undefined
		const steps = tail.kind === 'followed' ? tail.waiting : tail.turn.steps
		if (steps.some((s) => s.kind === 'approval' && !s.resolved)) return 'approval'
		if (steps.some((s) => s.kind === 'clarify' && s.answer === undefined)) return 'answer'
	}

	async function create(opts: { projectId?: string; instructions?: string } = {}) {
		const s = await gateway.createSession(opts.instructions ? { system_prompt: opts.instructions } : {})
		list.value.unshift(s)
		messages[s.id] = []
		if (opts.projectId) await useProjects().assign(opts.projectId, s.id)
		return s
	}

	async function send(id: string, text: string, images: string[] = []) {
		if (live[id] || remote[id]?.runId) {
			// A message sent mid-run steers the agent instead of queueing a new turn.
			const runId = live[id] ? live[id].runId : remote[id]!.runId
			if (runId) {
				await gateway.steer(runId, text, id).then(
					() => toasts.push('Sent to the running agent'),
					(e) => toasts.error(`Could not steer: ${(e as Error).message}`),
				)
			}
			return
		}
		const payload =
			images.length > 0
				? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
				: text
		const turn = reactive<AgentTurn>({ kind: 'agent', key: 'live-agent', steps: [], reasoning: '', live: true })
		const l: Live = reactive({
			turn,
			user: { text, images },
			abort: new AbortController(),
			after: newestId(messages[id] ?? []),
		}) as Live
		live[id] = l
		const clock = usePreferences().prefs.runStats ? new RunClock() : null
		const before = clock ? gateway.session(id).then(counters, () => null) : null
		let usage: { input_tokens?: number; output_tokens?: number } | undefined
		const writer = new TurnWriter(turn, clock)
		let lost = false

		// The chat stream says the clarify tool started but not what it asks: the run's status holds the questions.
		// It asks them one at a time, so the run is read until the tool is done.
		let clarifyTimer: ReturnType<typeof setTimeout> | undefined
		const watchClarify = async () => {
			clearTimeout(clarifyTimer)
			const runId = l.runId
			const asking = () =>
				live[id] === l && turn.steps.some((s) => s.kind === 'tool' && s.name === 'clarify' && s.status === 'running')
			if (!runId || !asking()) return
			const status = await gateway.run(runId, id).catch(() => null)
			if (!asking()) return
			if (status) {
				const asked = pendingClarify(status)
				for (const q of asked) writer.ask(clarifyStep(q, { run: runId, generation: q.generation }))
				// Shown but no longer asked: answered somewhere else, or it ran out.
				for (const s of turn.steps)
					if (s.kind === 'clarify' && 'run' in s.via && s.answer === undefined && !asked.some((q) => q.id === s.id))
						writer.clarifySettled(s.id)
			}
			clarifyTimer = setTimeout(watchClarify, CLARIFY_MS)
		}

		// A bot's Bot Chat runs in the bot's own queue, and its stream reports nothing until the reply is done.
		// Where Hermes lets a socket view the chat, the turn streams from there (`onWatch` below). Otherwise it is
		// filled in from the steps Hermes saves as it goes, until the stream says more.
		const profile = sessionProfile(id) ?? 'default'
		let watch: BotChatWatch | null = null
		let ownWatch: BotChatWatch | null = null
		let streamed = false
		let savedTimer: ReturnType<typeof setTimeout> | undefined
		let after = l.after
		const watchSaved = async () => {
			if (live[id] !== l || streamed) return
			try {
				const { ms } = await fetchTail(id, LIVE_TAIL * 2)
				// Nothing held yet: the work starts after the newest message from a person, this one.
				after ??= startId(ms)
				const p = live[id] === l && !streamed && after !== undefined ? savedProgress(ms, after) : null
				if (p && (p.steps.length || p.reasoning)) {
					turn.steps = p.steps
					turn.reasoning = p.reasoning
				}
			} catch {
				// The next read tries again; the reply arrives with the stream's end either way.
			}
			if (live[id] === l && !streamed) savedTimer = setTimeout(watchSaved, SAVED_MS)
		}
		const onWatch = (ev: WatchEvent) => {
			if (live[id] !== l) return
			streamed = true
			const o = writer.apply(ev, { profile, session: watch?.session ?? '' })
			if (o.status) l.status = o.status
			if (o.gap) {
				// The view fell behind and Hermes dropped it: read the saved steps instead.
				streamed = false
				savedTimer = setTimeout(watchSaved, SAVED_MS)
			}
		}
		// The open chat is watched already, else it is watched for this turn. A turn running as this is sent (another
		// bot's message, a routine) is not this one: this message waits behind it, and that turn keeps its own place.
		watch = botViews[id] ?? (isBotChat(id) ? (ownWatch = await watchBotChat(profile, id)) : null)
		const release = watch?.claim(onWatch)
		if (!watch && isBotChat(id)) savedTimer = setTimeout(watchSaved, SAVED_MS)

		// The relay keeps the turn's stream. When the connection drops (the phone slept, the network changed), the turn
		// picks it up again where it broke off once the device is back.
		let streamKey = ''
		let seen = -1
		const streamOpts = {
			signal: l.abort.signal,
			onStream: (key: string) => (streamKey = key),
			onFrame: (n: number) => (seen = n),
		}
		let events = gateway.chat(id, payload, streamOpts)
		try {
			for (let tries = 0; ;) {
				try {
					for await (const ev of events) {
						tries = 0
						if (!['run.started', 'run.finished', 'assistant.completed', 'status', 'error'].includes(ev.type)) {
							// The stream carries the steps after all: start the turn over from it.
							if (!streamed && savedTimer !== undefined) writer.restart()
							streamed = true
						}
						const o = writer.applyChat(ev)
						if (o.status) l.status = o.status
						if (ev.type === 'tool.started' && ev.tool === 'clarify') void watchClarify()
						if (ev.type === 'run.finished' && ev.status === 'completed') usage = ev.usage
						if (ev.type === 'run.started') {
							l.runId = ev.run_id
							void watchClarify()
							if (l.stopRequested) gateway.stopRun(ev.run_id, id).catch(() => l.abort.abort())
							// Hermes names the chat from the message as the run starts.
							setTimeout(() => refreshSession(id, true), 1500)
						}
					}
					break
				} catch (e) {
					if (!streamKey || !dropped(e) || ++tries > REJOIN_TRIES) throw e
					await backAgain(tries, l.abort.signal)
					events = gateway.rejoin(streamKey, seen, streamOpts)
				}
			}
		} catch (e) {
			const err = e as Error & { status?: number; code?: string }
			// Gone for good (no longer kept, or the device stayed away): the run goes on and is followed below.
			if (err.name === 'StreamLost' || (streamKey && err.name !== 'AbortError' && (err.status === 404 || dropped(e))))
				lost = true
			else if (err.name !== 'AbortError') {
				turn.error =
					err.status === 409 && err.code === 'permission_denied'
						? 'This conversation belongs to another channel and cannot be continued from here. Start a copy to keep going.'
						: err.message
			}
		} finally {
			writer.flush()
			clearTimeout(savedTimer)
			clearTimeout(clarifyTimer)
			// Lost, the turn goes on without this tab's stream: its later events show as a turn started elsewhere.
			release?.(lost)
			ownWatch?.close()
			const timing = clock?.finish()
			// Read off saved steps, the turn has no timing of its own to split into reading and writing.
			if (timing && !streamed) timing.promptMs = timing.genMs = timing.toolMs = undefined
			const failed = turn.error
			// A load that started before the run ended would miss its last messages.
			await inflight.get(id)
			await loadMessages(id, { quiet: lost })
			delete live[id]
			if (failed) lastError.value = { ...lastError.value, [id]: failed }
			else clearError(id)
			// The run goes on without this tab's stream: follow it like one started elsewhere.
			if (lost && followed === id) void poll(id, true)
			await settle(id)
			if (timing && usage && !failed && !lost) {
				const key = lastReplyKey(messages[id] ?? [])
				if (key) recordStats(`${id}:${key}`, turnStats(timing, turnTokens(await before, counters(byId(id)), usage)))
			}
		}
	}

	/**
	 * The open Bot Chat stays watched on the Hermes socket (where the connection can view one), so a turn that did
	 * not start here shows live too: another bot's message, a routine, a turn already running when the page loaded.
	 * A turn sent from here claims its own events from the watch.
	 */
	type BotTurn = {
		turn: AgentTurn
		writer: TurnWriter
		/** The newest message saved before the turn's own: the transcript shows up to it while the turn runs. */
		after?: number
		status?: string
	}
	const botViews: Record<string, BotChatWatch> = {}
	const botTurns = reactive<Record<string, BotTurn>>({})

	function isBotChat(id: string) {
		return byId(id)?.title === BOT_CHAT_TITLE
	}

	async function watchBot(id: string) {
		if (botViews[id] || !isBotChat(id) || useApp().liveBots === false) return
		const profile = sessionProfile(id) ?? 'default'
		let mine: BotTurn | undefined
		const w = await watchBotChat(profile, id, {
			reattach: true,
			onTurn: (_generation, midway, session) => {
				// Running as the chat opened while this tab sends one: that is the turn shown.
				if (midway && live[id]) return undefined
				const bt = (mine = startBotTurn(id, midway))
				return {
					event(ev) {
						if (botTurns[id] !== bt) return
						const o = bt.writer.apply(ev, { profile, session })
						if (o.status) bt.status = o.status
					},
					end: () => void finishBotTurn(id, bt),
				}
			},
		})
		if (!w) return
		if (followed !== id || botViews[id]) {
			w.close()
			if (mine && botTurns[id] === mine) delete botTurns[id]
			return
		}
		botViews[id] = w
	}

	function unwatchBot(id: string) {
		const w = botViews[id]
		if (!w) return
		delete botViews[id]
		w.close()
		delete botTurns[id]
	}

	function startBotTurn(id: string, midway: boolean): BotTurn {
		const turn = reactive<AgentTurn>({ kind: 'agent', key: 'remote-agent', steps: [], reasoning: '', live: true })
		const bt = reactive({ turn, writer: new TurnWriter(turn) }) as BotTurn
		botTurns[id] = bt
		// Bring the chat up to the turn's start: the message that began it is saved by now. A turn joined midway has
		// saved its first steps too; those are shown from the copy, and the transcript stops before them.
		refreshTail(id, { limit: LIVE_TAIL })
			.then(() => {
				if (botTurns[id] !== bt) return
				const ms = messages[id] ?? []
				if (!midway) {
					bt.after = newestId(ms)
					if (!turnStartHeld(ms, bt.after)) void awaitStart(id, bt)
					return
				}
				bt.after = startId(ms)
				const p = bt.after !== undefined ? savedProgress(ms, bt.after) : null
				// Questions still waiting from before the watch began come after the steps that led to them.
				const waiting = turn.steps.filter((s) => s.kind === 'approval' || s.kind === 'clarify')
				if (p && waiting.length === turn.steps.length && !turn.reasoning) {
					turn.steps = [...p.steps, ...waiting]
					turn.reasoning = p.reasoning
				}
			})
			.catch(() => {})
		return bt
	}

	/**
	 * The turn started before the message that began it was saved (sent from another device): read the chat again
	 * until it is there, so it shows above the turn rather than only once the turn ends. A turn that no message began
	 * (a routine) stops looking after a few tries.
	 */
	async function awaitStart(id: string, bt: BotTurn, tries = 6) {
		for (let i = 0; i < tries; i++) {
			await new Promise((r) => setTimeout(r, START_MS))
			if (botTurns[id] !== bt) return
			await refreshTail(id, { limit: LIVE_TAIL }).catch(() => {})
			if (turnStartHeld(messages[id] ?? [], bt.after)) return
		}
	}

	function clearError(id: string) {
		if (!(id in lastError.value)) return
		const { [id]: _, ...rest } = lastError.value
		lastError.value = rest
	}

	async function finishBotTurn(id: string, bt: BotTurn) {
		if (botTurns[id] !== bt) return
		// A turn that ran to its end here: an error from an earlier one is old news.
		if (!bt.turn.error) clearError(id)
		bt.writer.flush()
		// The turn stays on screen until the transcript that replaces it is here.
		await loadMessages(id, { quiet: true })
		if (botTurns[id] === bt) delete botTurns[id]
		await settle(id)
	}

	function recordStats(key: string, stats: RunStats) {
		saveStats(key, stats)
		runStats.value = { ...runStats.value, [key]: stats }
	}

	/** How fast a reply ran, when it streamed in this browser with the speed line on. */
	function statsFor(id: string, turnKey: string): RunStats | undefined {
		return runStats.value[`${id}:${turnKey}`]
	}

	/** Fetch a session again; moved to the top unless `inPlace`. */
	async function refreshSession(id: string, inPlace = false) {
		const s = await gateway.session(id).catch(() => null)
		if (s) place(s, inPlace)
	}

	/** A run of this session just ended: show its final state now and its upgraded title once Hermes has it. */
	async function settle(id: string) {
		await refreshSession(id)
		for (const ms of TITLE_CHECKS_MS) setTimeout(() => !live[id] && refreshSession(id, true), ms)
	}

	async function stop(id: string) {
		const l = live[id]
		const remoteRun = remote[id]?.runId
		if (!l && remoteRun) {
			await gateway.stopRun(remoteRun, id).catch((e) => toasts.error(`Could not stop the run: ${(e as Error).message}`))
			return
		}
		if (!l) return
		if (l.runId) {
			await gateway.stopRun(l.runId, id).catch(() => l.abort.abort())
			return
		}
		// The relay keeps the run going without this tab, so stop it once its id arrives.
		l.stopRequested = true
		setTimeout(() => !l.runId && l.abort.abort(), 5000)
	}

	/** Decide an approval the agent waits for, where it asked: its run, or the Hermes socket a Bot Chat is watched on. */
	async function answerApproval(id: string, step: ApprovalStep, choice: string) {
		const v = step.via
		if (!v || step.resolved) return
		try {
			if ('run' in v) await gateway.approve(v.run, choice, id)
			else
				await post(`ui-api/bots/${encodeURIComponent(v.profile)}/approval`, {
					session: v.session,
					generation: v.generation,
					prompt: v.id,
					choice,
				})
			step.resolved = choice
			// A run followed from here shows its approval while Hermes still reports it.
			const r = remote[id]
			if (r?.approval && 'run' in v && v.run === r.approval) r.approval = undefined
		} catch (e) {
			const err = e as Error & { code?: string }
			if (err.code === 'approval_not_pending' || err.code === 'stale_generation') {
				step.resolved = 'elsewhere'
				toasts.error('That approval was already decided or ran out.')
			} else toasts.error(`Could not send the decision: ${err.message}`)
		}
	}

	/** Answer a question the agent asked with its clarify tool. */
	async function answerClarify(id: string, step: ClarifyStep, answer: string) {
		const v = step.via
		try {
			if ('run' in v) await gateway.clarify(v.run, { id: step.id, generation: v.generation }, answer, id)
			else
				await post(`ui-api/bots/${encodeURIComponent(v.profile)}/clarify`, {
					session: v.session,
					generation: v.generation,
					prompt: step.id,
					answer,
				})
			step.answer = answer
			const r = remote[id]
			if (r?.clarify) r.clarify = r.clarify.filter((q) => q.id !== step.id)
		} catch (e) {
			const err = e as Error & { code?: string }
			if (err.code === 'approval_not_pending' || err.code === 'stale_generation') {
				step.answer = 'elsewhere'
				toasts.error('That question was already answered or ran out.')
			} else toasts.error(`Could not send the answer: ${err.message}`)
		}
	}

	/**
	 * Keep the open session current while it runs somewhere this tab is not streaming: another tab or
	 * device (the relay knows its run id, so approvals, stop and steering work here too) or another
	 * channel such as the terminal (Hermes saves each step, so the transcript fills in as it goes).
	 */
	let followed: string | undefined
	let followTimer: ReturnType<typeof setTimeout> | undefined

	function follow(id?: string) {
		clearTimeout(followTimer)
		if (followed && followed !== id) {
			delete remote[followed]
			unwatchBot(followed)
		}
		followed = id
		if (id) {
			followTimer = setTimeout(() => poll(id), 0)
			void watchBot(id)
		}
	}

	/** `changed`: Hermes reported a write, so read the chat even when nothing seems to be running in it. */
	async function poll(id: string, changed = false) {
		let next = IDLE_MS
		try {
			// A turn watched on the Hermes socket brings its own steps; its transcript is read when it ends.
			if (followed !== id || document.hidden || live[id] || botTurns[id]) return
			await syncRuns()
			const runId = activeRuns.value[id]
			const stale = !runId && !unfinished(messages[id] ?? [])
			if (stale && !remote[id] && !changed) return
			const ok = () => followed === id && !live[id]
			const [status, fresh] = await Promise.all([
				runId ? gateway.run(runId, id).catch(() => null) : null,
				refreshTail(id, { limit: LIVE_TAIL, ok }).then(
					() => true,
					() => false,
				),
			])
			if (!ok() || !fresh) return
			const ms = messages[id] ?? []
			const lastAt = Number(lastOf(ms, (m) => m.timestamp)?.timestamp ?? 0)
			const running = runId
				? !['completed', 'failed', 'cancelled'].includes(status?.status ?? 'running')
				: unfinished(ms) && Date.now() / 1000 - lastAt < STALE_S
			if (running) {
				remote[id] = { runId, approval: pendingApproval(status), clarify: pendingClarify(status) }
				next = FOLLOW_MS
			} else if (remote[id]) {
				delete remote[id]
				clearError(id)
				await settle(id)
			}
		} finally {
			// One loop per chat, however many reads (timer, event, tab focus) overlapped.
			if (followed === id) {
				clearTimeout(followTimer)
				followTimer = setTimeout(() => poll(id), next)
			}
		}
	}

	/**
	 * Which sessions are running anywhere through this server, for the sidebar. Survives a reload: the
	 * relay keeps the runs going and tracks them, this tab only asks.
	 */
	async function syncRuns() {
		const next = await gateway.activeRuns().catch(() => null)
		if (!next) return
		const prev = activeRuns.value
		activeRuns.value = next
		for (const id of Object.keys(prev)) if (!next[id] && !live[id] && id !== followed) void settle(id)
		for (const id of Object.keys(next)) if (!prev[id] && !byId(id)) void refreshSession(id)
	}

	let runsTimer: ReturnType<typeof setTimeout> | undefined
	async function watchRuns() {
		clearTimeout(runsTimer)
		try {
			if (!document.hidden) await syncRuns()
		} finally {
			runsTimer = setTimeout(watchRuns, RUNS_MS)
		}
	}
	void watchRuns()

	// Back after being away: chats changed elsewhere meanwhile, and the open one may have moved on.
	onResync(() => {
		void refreshList()
		void watchRuns()
		if (followed && !live[followed]) void poll(followed, true)
	})

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void watchRuns()
		if (document.hidden || !followed || live[followed]) return
		clearTimeout(followTimer)
		const id = followed
		void poll(id, true)
	})

	// A running chat writes all the time: the list follows its changes at most every 10 s.
	let listTimer: ReturnType<typeof setTimeout> | undefined
	function listSoon() {
		if (listTimer || document.hidden) return
		listTimer = setTimeout(() => {
			listTimer = undefined
			void refreshList()
		}, 10_000)
	}

	// Hermes reports writes to its sessions (from any channel: terminal, Telegram, schedules) at most every 2s.
	// The open chat reads its newest messages on each; the timers above stay as the fallback without events.
	let changedTimer: ReturnType<typeof setTimeout> | undefined
	let offChanged: (() => void) | undefined
	watch(
		() => !!useApp().dashboard?.ok,
		(ok) => {
			offChanged?.()
			offChanged = ok
				? onRpcEvent('sessions.changed', () => {
						listSoon()
						const id = followed
						if (!id || live[id] || document.hidden) return
						clearTimeout(changedTimer)
						changedTimer = setTimeout(() => {
							if (followed !== id) return
							clearTimeout(followTimer)
							void poll(id, true)
						}, 250)
					})
				: undefined
		},
		{ immediate: true },
	)

	async function rename(id: string, title: string) {
		await gateway.updateSession(id, { title })
		const s = byId(id)
		if (s) s.title = title
	}

	async function togglePin(id: string) {
		const s = byId(id)
		if (!s) return
		await gateway.updateSession(id, { pinned: !s.pinned })
		s.pinned = !s.pinned
	}

	async function archive(id: string) {
		await gateway.updateSession(id, { archived: true })
		const s = byId(id)
		if (s) s.archived = true
	}

	async function remove(id: string) {
		await gateway.deleteSession(id)
		list.value = list.value.filter((s) => s.id !== id)
		delete botSessions[id]
		delete messages[id]
		delete older[id]
		void forgetTranscript(id)
	}

	async function fork(id: string) {
		const s = await gateway.forkSession(id)
		list.value.unshift(s)
		return s
	}

	return {
		list,
		visible,
		hasMore,
		loadingList,
		listError,
		showScheduled,
		setShowScheduled,
		ensureList,
		prefetch,
		hasTranscript,
		isLoading,
		isRefreshing,
		refreshError,
		hasOlder,
		isLoadingOlder,
		loadOlder,
		live,
		botTurns,
		lastError,
		remote,
		activeRuns,
		follow,
		loadList,
		loadMessages,
		turnsFor,
		statsFor,
		byId,
		create,
		send,
		stop,
		answerApproval,
		answerClarify,
		waitingOn,
		rename,
		togglePin,
		archive,
		remove,
		fork,
		refreshSession,
		place,
	}
})
