import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import { gateway, type ApprovalRequest, type Message, type Session } from '@/lib/gateway'
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
	const list = ref<Session[]>([])
	const hasMore = ref(false)
	const loadingList = ref(false)
	const listError = ref('')
	const showScheduled = ref(localStorage.getItem('caduceus.showScheduled') === '1')

	const messages = reactive<Record<string, Message[]>>({})
	const loadingMessages = ref(false)
	const live = reactive<Record<string, Live>>({})
	const lastError = shallowRef<Record<string, string>>({})

	async function loadList(more = false) {
		loadingList.value = true
		listError.value = ''
		try {
			const r = await gateway.sessions({ limit: 60, offset: more ? list.value.length : 0 })
			const merged = more
				? [...list.value, ...r.data]
				: [...r.data, ...list.value.filter((x) => !r.data.some((y) => y.id === x.id) && live[x.id])]
			list.value = merged.filter((s, i) => merged.findIndex((x) => x.id === s.id) === i)
			hasMore.value = r.has_more
		} catch (e) {
			listError.value = (e as Error).message
		} finally {
			loadingList.value = false
		}
	}

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

	async function loadMessages(id: string) {
		loadingMessages.value = true
		try {
			messages[id] = await gateway.messages(id)
			if (!byId(id)) {
				const s = await gateway.session(id).catch(() => null)
				if (s && !byId(id)) list.value.unshift(s)
			}
		} catch (e) {
			toasts.error(`Could not load this conversation: ${(e as Error).message}`)
		} finally {
			loadingMessages.value = false
		}
	}

	function turnsFor(id: string): Turn[] {
		const turns = buildTurns(messages[id] ?? [])
		const l = live[id]
		if (l) {
			turns.push({ kind: 'user', key: 'live-user', text: l.user.text, images: l.user.images })
			turns.push(l.turn)
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
		if (live[id]) {
			// A message sent mid-run steers the agent instead of queueing a new turn.
			const runId = live[id].runId
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
		const firstMessage = (messages[id] ?? []).length === 0

		try {
			for await (const ev of gateway.chat(id, payload, { signal: l.abort.signal })) {
				switch (ev.type) {
					case 'run.started':
						l.runId = ev.run_id
						break
					case 'assistant.delta': {
						const last = turn.steps.at(-1)
						if (last?.kind === 'text') last.text += ev.delta
						else turn.steps.push({ kind: 'text', text: ev.delta.replace(/^\s+/, '') })
						break
					}
					case 'assistant.commentary':
						turn.steps.push({ kind: 'text', text: ev.text })
						break
					case 'reasoning':
						turn.reasoning += ev.delta
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
			const failed = turn.error
			await loadMessages(id)
			delete live[id]
			if (failed) lastError.value = { ...lastError.value, [id]: failed }
			else {
				const { [id]: _, ...rest } = lastError.value
				lastError.value = rest
			}
			await refreshSession(id, firstMessage ? text : undefined)
		}
	}

	async function refreshSession(id: string, firstText?: string) {
		let s = await gateway.session(id).catch(() => null)
		if (s && !s.title && firstText) {
			const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 60)
			if (title) {
				await gateway.updateSession(id, { title }).catch(() => {})
				s = { ...s, title }
			}
		}
		if (!s) return
		const i = list.value.findIndex((x) => x.id === id)
		if (i >= 0) list.value.splice(i, 1)
		list.value.unshift(s)
	}

	async function stop(id: string) {
		const l = live[id]
		if (!l) return
		if (l.runId) await gateway.stopRun(l.runId).catch(() => l.abort.abort())
		else l.abort.abort()
	}

	async function answerApproval(id: string, choice: string) {
		const l = live[id]
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
		messages,
		loadingMessages,
		live,
		lastError,
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
