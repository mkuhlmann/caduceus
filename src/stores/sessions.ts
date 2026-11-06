import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import { gateway, pendingApproval, type ApprovalRequest, type Message, type Session } from '@/lib/gateway'
import { buildTurns, type AgentTurn, type ApprovalStep, type ToolStep, type Turn } from '@/lib/turns'
import { useToasts } from './toast'
import { useProjects } from './projects'

type Live = {
	runId?: string
	turn: AgentTurn
	user: { text: string; images: string[] }
	abort: AbortController
	approval?: ApprovalRequest
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
	const inflight = new Map<string, Promise<void>>()
	const recent: string[] = []
	const live = reactive<Record<string, Live>>({})
	const lastError = shallowRef<Record<string, string>>({})
	const remote = reactive<Record<string, Remote>>({})
	const activeRuns = ref<Record<string, string>>({})

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

	function byId(id: string) {
		return list.value.find((s) => s.id === id)
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

	/** Fetch a transcript; concurrent calls for the same chat share one request. Quiet ones do not toast. */
	function loadMessages(id: string, quiet = false): Promise<void> {
		const running = inflight.get(id)
		if (running) return running
		loading[id] = true
		const p = (async () => {
			try {
				const ms = await gateway.messages(id)
				// Keep the same array when nothing changed, so nothing re-renders.
				if (!sameTranscript(messages[id], ms)) messages[id] = ms
				touch(id)
				if (!byId(id)) {
					const s = await gateway.session(id).catch(() => null)
					if (s && !byId(id)) list.value.unshift(s)
				}
			} catch (e) {
				if (!quiet) toasts.error(`Could not load this conversation: ${(e as Error).message}`)
			} finally {
				delete loading[id]
				inflight.delete(id)
			}
		})()
		inflight.set(id, p)
		return p
	}

	/** Warm the cache for a chat the user is about to open (hover or touch on its row). */
	function prefetch(id: string) {
		if (!messages[id] && !live[id]) void loadMessages(id, true)
	}

	function hasTranscript(id: string) {
		return !!messages[id]
	}

	function isLoading(id: string) {
		return !!loading[id]
	}

	function turnsFor(id: string): Turn[] {
		const turns = [...turnsOf(messages[id] ?? [])]
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
				await gateway.steer(runId, text).then(
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

		try {
			for await (const ev of gateway.chat(id, payload, { signal: l.abort.signal })) {
				if (ev.type === 'assistant.delta') {
					written += ev.delta
					later()
					continue
				}
				if (ev.type === 'reasoning') {
					thought += ev.delta
					later()
					continue
				}
				// Anything else lands after the text before it.
				flush()
				switch (ev.type) {
					case 'run.started':
						l.runId = ev.run_id
						if (l.stopRequested) gateway.stopRun(ev.run_id).catch(() => l.abort.abort())
						// Hermes names the chat from the message as the run starts.
						setTimeout(() => refreshSession(id, true), 1500)
						break
					case 'assistant.commentary':
						turn.steps.push({ kind: 'text', text: ev.text })
						break
					case 'tool.started':
						turn.steps.push({
							kind: 'tool',
							name: ev.tool,
							preview: ev.preview,
							args: (ev.args as any) ?? null,
							status: 'running',
						})
						break
					case 'tool.completed': {
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
		}
	}

	/** Fetch a session again; moved to the top unless `inPlace`. */
	async function refreshSession(id: string, inPlace = false) {
		const s = await gateway.session(id).catch(() => null)
		if (!s) return
		const i = list.value.findIndex((x) => x.id === id)
		if (inPlace && i >= 0) list.value.splice(i, 1, s)
		else {
			if (i >= 0) list.value.splice(i, 1)
			list.value.unshift(s)
		}
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
			await gateway.stopRun(remoteRun).catch((e) => toasts.error(`Could not stop the run: ${(e as Error).message}`))
			return
		}
		if (!l) return
		if (l.runId) {
			await gateway.stopRun(l.runId).catch(() => l.abort.abort())
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
				await gateway.approve(r.approval, choice)
				r.approval = undefined
			} catch (e) {
				toasts.error(`Could not send the decision: ${(e as Error).message}`)
			}
			return
		}
		if (!l?.approval) return
		try {
			await gateway.approve(l.approval, choice)
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

	async function poll(id: string) {
		let next = IDLE_MS
		try {
			if (followed !== id || document.hidden || live[id]) return
			await syncRuns()
			const runId = activeRuns.value[id]
			const stale = !runId && !unfinished(messages[id] ?? [])
			if (stale && !remote[id]) return
			const [status, ms] = await Promise.all([
				runId ? gateway.run(runId).catch(() => null) : null,
				gateway.messages(id).catch(() => null),
			])
			if (followed !== id || live[id] || !ms) return
			if (!sameTranscript(messages[id], ms)) messages[id] = ms
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
			if (followed === id) followTimer = setTimeout(() => poll(id), next)
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
		gateway
			.messages(id)
			.then((ms) => {
				if (followed === id && !live[id] && !sameTranscript(messages[id], ms)) messages[id] = ms
			})
			.catch(() => {})
			.finally(() => poll(id))
	})

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
		delete messages[id]
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
		live,
		lastError,
		remote,
		activeRuns,
		follow,
		loadList,
		loadMessages,
		turnsFor,
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
	}
})
