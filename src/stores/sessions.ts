import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import {
	BOT_CHAT_TITLE,
	gateway,
	pendingApproval,
	sessionProfile,
	type ApprovalRequest,
	type Message,
	type Session,
} from '@/lib/gateway'
import { buildTurns, savedProgress, type AgentTurn, type ApprovalStep, type ToolStep, type Turn } from '@/lib/turns'
import { useToasts } from './toast'
import { useProjects } from './projects'
import { forgetTranscript, readTranscript, saveTranscript } from '@/lib/transcript-cache'
import { fetchOlder, fetchTail, LIVE_TAIL, mergeTail, prependOlder, TAIL, type Tail } from '@/lib/transcript-pages'
import { onRpcEvent } from '@/lib/rpc'
import { watchBotChat, type BotWatch, type WatchEvent } from '@/lib/bot-watch'
import { post } from '@/lib/http'
import { counters, RunClock, savedStats, saveStats, turnStats, turnTokens, type RunStats } from '@/lib/run-stats'
import { useApp } from './app'

type Live = {
	runId?: string
	turn: AgentTurn
	user: { text: string; images: string[] }
	abort: AbortController
	approval?: ApprovalRequest
	/** An approval a Bot Chat's turn asks for, answered on the Hermes socket rather than through a run. */
	prompt?: { profile: string; session: string; generation: number; id: string }
	status?: string
	stopRequested?: boolean
}

/** A run of the open session that this tab did not start: another tab, device or channel. */
type Remote = { runId?: string; approval?: ApprovalRequest }

const FOLLOW_MS = 2000
const IDLE_MS = 6000
// A transcript that stopped mid-turn longer ago than this is an interrupted run, not a live one.
const STALE_S = 10 * 60
const RUNS_MS = 4000
// How often a Bot Chat's saved steps are read while the bot works.
const SAVED_MS = 1500
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

// Turns are derived from a transcript array that is replaced, never mutated, so they can be cached per array.
const turnCache = new WeakMap<Message[], Turn[]>()
function turnsOf(ms: Message[]) {
	let t = turnCache.get(ms)
	if (!t) turnCache.set(ms, (t = buildTurns(ms)))
	return t
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
		const all = turnsOf(messages[id] ?? [])
		// A page can start in the middle of the agent's work; that turn shows once its start is loaded.
		const turns = older[id] && all[0]?.kind === 'agent' && all.length > 1 ? all.slice(1) : [...all]
		const l = live[id]
		if (l) {
			turns.push({ kind: 'user', key: 'live-user', text: l.user.text, images: l.user.images })
			turns.push(l.turn)
			return turns
		}
		const r = remote[id]
		if (r) {
			const last = turns.at(-1)
			// A copy: the cached turns are shared and must not be marked live.
			const turn: AgentTurn =
				last?.kind === 'agent'
					? { ...last, steps: [...last.steps] }
					: { kind: 'agent', key: 'remote-agent', steps: [], reasoning: '' }
			if (last?.kind === 'agent') turns[turns.length - 1] = turn
			else turns.push(turn)
			turn.live = true
			const a = r.approval
			if (a) {
				const choices = a.choices ?? ['once', 'session', 'always', 'deny']
				turn.steps.push({ kind: 'approval', command: a.command, description: a.description, choices })
			}
		}
		return turns
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
		const l: Live = reactive({ turn, user: { text, images }, abort: new AbortController() }) as Live
		live[id] = l
		const clock = useApp().runStats ? new RunClock() : null
		const before = clock ? gateway.session(id).then(counters, () => null) : null
		let usage: { input_tokens?: number; output_tokens?: number } | undefined

		// A bot's Bot Chat runs in the bot's own queue, and its stream reports nothing until the reply is done.
		// Where Hermes lets a socket view the chat, the turn streams from there (`onWatch` below). Otherwise it is
		// filled in from the steps Hermes saves as it goes, until the stream says more.
		const botChat = byId(id)?.title === BOT_CHAT_TITLE
		const profile = sessionProfile(id) ?? 'default'
		let watch: BotWatch | null = null
		let streamed = false
		let savedTimer: ReturnType<typeof setTimeout> | undefined
		const heldIds = (messages[id] ?? []).map((m) => Number(m.id)).filter(Number.isFinite)
		let after = heldIds.length ? Math.max(...heldIds) : undefined
		const watchSaved = async () => {
			if (live[id] !== l || streamed) return
			try {
				const { ms } = await fetchTail(id, LIVE_TAIL * 2)
				// Nothing held yet: the work starts after the newest message from a person, this one.
				after ??= Number([...ms].reverse().find((m) => m.role === 'user')?.id ?? NaN)
				const p = live[id] === l && !streamed && Number.isFinite(after) ? savedProgress(ms, after) : null
				if (p && (p.steps.length || p.reasoning)) {
					turn.steps = p.steps
					turn.reasoning = p.reasoning
				}
			} catch {
				// The next read tries again; the reply arrives with the stream's end either way.
			}
			if (live[id] === l && !streamed) savedTimer = setTimeout(watchSaved, SAVED_MS)
		}

		// Tokens arrive faster than the screen refreshes. Collect them and apply them once per frame, so a
		// streaming reply re-renders at most once per frame however fast the model writes.
		let written = ''
		let thought = ''
		let frame = 0
		const flush = () => {
			cancelAnimationFrame(frame)
			frame = 0
			if (written) {
				const last = turn.steps.at(-1)
				if (last?.kind === 'text') last.text += written
				else {
					const t = written.replace(/^\s+/, '')
					if (t) turn.steps.push({ kind: 'text', text: t })
				}
				written = ''
			}
			if (thought) {
				turn.reasoning += thought
				thought = ''
			}
		}
		const later = () => {
			if (!frame) frame = requestAnimationFrame(flush)
		}

		// A turn already running when the watch began is someone else's: this message waits behind it.
		let otherTurn: number | null = null
		const onWatch = (ev: WatchEvent) => {
			if (live[id] !== l || (otherTurn !== null && ev.generation === otherTurn)) return
			const p = ev.payload ?? {}
			const text = typeof p.text === 'string' ? p.text : ''
			streamed = true
			switch (ev.type) {
				case 'message.start':
					clock?.turnStarted()
					return
				case 'message.delta':
					if (!text) return
					clock?.output()
					written += text
					return later()
				case 'thinking.delta':
					// Hermes' spinner line ("reasoning..."), not what the model thinks.
					return
				case 'reasoning.delta':
					if (!text) return
					clock?.output(true)
					thought += text
					return later()
				case 'reasoning.available':
					// A finished block, from a model that does not stream its reasoning.
					if (text && !thought && !turn.reasoning.endsWith(text)) {
						clock?.output()
						thought += (turn.reasoning ? '\n\n' : '') + text
						later()
					}
					return
			}
			flush()
			switch (ev.type) {
				case 'message.interim':
					if (text && !p.already_streamed) {
						clock?.output()
						turn.steps.push({ kind: 'text', text })
					}
					break
				case 'tool.start':
					clock?.toolStarted()
					turn.steps.push({
						kind: 'tool',
						id: p.tool_id ?? p.tool_call_id,
						name: p.name ?? p.tool_name ?? 'tool',
						preview: p.context ?? null,
						args: p.args && typeof p.args === 'object' ? p.args : null,
						status: 'running',
					})
					break
				case 'tool.complete': {
					clock?.toolDone()
					const tid = p.tool_id ?? p.tool_call_id
					const step = [...turn.steps]
						.reverse()
						.find(
							(s): s is ToolStep =>
								s.kind === 'tool' && s.status === 'running' && (tid ? s.id === tid : s.name === p.name),
						)
					if (step) {
						step.status = p.is_error ? 'failed' : 'done'
						if (typeof p.result_text === 'string') step.output = p.result_text
						else if (typeof p.result === 'string') step.output = p.result
					}
					break
				}
				case 'status.update':
					if (text) l.status = text
					break
				case 'approval.request': {
					const generation = ev.generation ?? p.execution_generation
					if (!watch || typeof generation !== 'number' || !p.prompt_id) break
					const choices: string[] = p.choices ?? ['once', 'session', 'always', 'deny']
					l.prompt = { profile, session: watch.session, generation, id: p.prompt_id }
					l.approval = { run_id: '', command: p.command, description: p.description, choices }
					turn.steps.push({ kind: 'approval', command: p.command, description: p.description, choices })
					break
				}
				case 'approval.settled':
					if (l.prompt?.id !== p.prompt_id) break
					// Answered somewhere else (Hermes Desktop, another tab) or run out: this one no longer can.
					for (const s of turn.steps) if (s.kind === 'approval' && !s.resolved) s.resolved = 'elsewhere'
					l.prompt = undefined
					l.approval = undefined
					break
				case 'session.replay_gap':
					// The view fell behind and Hermes dropped it: read the saved steps instead.
					watch?.close()
					streamed = false
					savedTimer = setTimeout(watchSaved, SAVED_MS)
					break
			}
		}
		if (botChat) {
			watch = await watchBotChat(profile, id, onWatch)
			if (watch?.running) otherTurn = watch.generation
			if (!watch) savedTimer = setTimeout(watchSaved, SAVED_MS)
		}

		try {
			for await (const ev of gateway.chat(id, payload, { signal: l.abort.signal })) {
				if (!['run.started', 'run.finished', 'assistant.completed', 'status', 'error'].includes(ev.type)) {
					if (!streamed && savedTimer !== undefined) {
						// The stream carries the steps after all: start the turn over from it.
						turn.steps = []
						turn.reasoning = ''
					}
					streamed = true
				}
				if (ev.type === 'assistant.delta') {
					clock?.output()
					written += ev.delta
					later()
					continue
				}
				if (ev.type === 'reasoning') {
					// A finished block, not a stream: the reasoning was written before it arrived.
					clock?.output()
					thought += ev.delta
					later()
					continue
				}
				// Anything else lands after the text before it.
				flush()
				switch (ev.type) {
					case 'run.started':
						l.runId = ev.run_id
						if (l.stopRequested) gateway.stopRun(ev.run_id, id).catch(() => l.abort.abort())
						// Hermes names the chat from the message as the run starts.
						setTimeout(() => refreshSession(id, true), 1500)
						break
					case 'assistant.commentary':
						clock?.output()
						turn.steps.push({ kind: 'text', text: ev.text })
						break
					case 'tool.started':
						clock?.toolStarted()
						turn.steps.push({
							kind: 'tool',
							name: ev.tool,
							preview: ev.preview,
							args: (ev.args as any) ?? null,
							status: 'running',
						})
						break
					case 'tool.completed': {
						clock?.toolDone()
						const step = [...turn.steps]
							.reverse()
							.find((s): s is ToolStep => s.kind === 'tool' && s.name === ev.tool && s.status === 'running')
						if (step) step.status = ev.failed ? 'failed' : 'done'
						break
					}
					case 'approval.request': {
						l.approval = ev.request
						const step: ApprovalStep = {
							kind: 'approval',
							command: ev.request.command,
							description: ev.request.description as string | undefined,
							choices: ev.request.choices ?? ['once', 'session', 'always', 'deny'],
						}
						turn.steps.push(step)
						break
					}
					case 'status':
						l.status = ev.text
						break
					case 'run.finished':
						if (ev.status === 'failed') turn.error = ev.error || 'The run failed.'
						if (ev.status === 'completed') usage = ev.usage
						break
					case 'error':
						turn.error = ev.message
						break
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				const err = e as Error & { status?: number; code?: string }
				turn.error =
					err.status === 409 && err.code === 'permission_denied'
						? 'This conversation belongs to another channel and cannot be continued from here. Start a copy to keep going.'
						: err.message
			}
		} finally {
			flush()
			clearTimeout(savedTimer)
			watch?.close()
			const timing = clock?.finish()
			// Read off saved steps, the turn has no timing of its own to split into reading and writing.
			if (timing && !streamed) timing.promptMs = timing.genMs = timing.toolMs = undefined
			const failed = turn.error
			// A load that started before the run ended would miss its last messages.
			await inflight.get(id)
			await loadMessages(id)
			delete live[id]
			if (failed) lastError.value = { ...lastError.value, [id]: failed }
			else {
				const { [id]: _, ...rest } = lastError.value
				lastError.value = rest
			}
			await settle(id)
			if (timing && usage && !failed) {
				const last = turnsOf(messages[id] ?? []).at(-1)
				if (last?.kind === 'agent')
					recordStats(`${id}:${last.key}`, turnStats(timing, turnTokens(await before, counters(byId(id)), usage)))
			}
		}
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

	async function answerApproval(id: string, choice: string) {
		const l = live[id]
		const r = remote[id]
		if (!l && r?.approval) {
			try {
				await gateway.approve(r.approval, choice, id)
				r.approval = undefined
			} catch (e) {
				toasts.error(`Could not send the decision: ${(e as Error).message}`)
			}
			return
		}
		if (l?.prompt) {
			const p = l.prompt
			try {
				await post(`ui-api/bots/${encodeURIComponent(p.profile)}/approval`, {
					session: p.session,
					generation: p.generation,
					prompt: p.id,
					choice,
				})
				const step = [...l.turn.steps].reverse().find((s): s is ApprovalStep => s.kind === 'approval' && !s.resolved)
				if (step) step.resolved = choice
				if (l.prompt === p) {
					l.prompt = undefined
					l.approval = undefined
				}
			} catch (e) {
				toasts.error(`Could not send the decision: ${(e as Error).message}`)
			}
			return
		}
		if (!l?.approval) return
		try {
			await gateway.approve(l.approval, choice, id)
			const step = [...l.turn.steps].reverse().find((s): s is ApprovalStep => s.kind === 'approval' && !s.resolved)
			if (step) step.resolved = choice
			l.approval = undefined
		} catch (e) {
			toasts.error(`Could not send the decision: ${(e as Error).message}`)
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
		if (followed && followed !== id) delete remote[followed]
		followed = id
		if (id) followTimer = setTimeout(() => poll(id), 0)
	}

	/** `changed`: Hermes reported a write, so read the chat even when nothing seems to be running in it. */
	async function poll(id: string, changed = false) {
		let next = IDLE_MS
		try {
			if (followed !== id || document.hidden || live[id]) return
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
				remote[id] = { runId, approval: pendingApproval(status) }
				next = FOLLOW_MS
			} else if (remote[id]) {
				delete remote[id]
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

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void watchRuns()
		if (document.hidden || !followed || live[followed]) return
		clearTimeout(followTimer)
		const id = followed
		void poll(id, true)
	})

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
		rename,
		togglePin,
		archive,
		remove,
		fork,
		refreshSession,
		place,
	}
})
