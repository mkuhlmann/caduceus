import { GW, get, post, patch, del, qs, url, toError } from './http'
import { readSse } from './sse'

export type Session = {
	id: string
	source?: string
	model?: string
	title?: string | null
	started_at?: number
	ended_at?: number | null
	end_reason?: string | null
	message_count?: number
	tool_call_count?: number
	input_tokens?: number
	output_tokens?: number
	estimated_cost_usd?: number
	parent_session_id?: string | null
	last_active?: number
	preview?: string
	pinned?: boolean
	archived?: boolean
	hidden?: boolean
}

export type ToolCall = { id?: string; type?: string; function?: { name: string; arguments: string } }

export type Message = {
	id?: number | string
	session_id?: string
	role: 'user' | 'assistant' | 'tool' | 'system'
	content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } | string }>
	tool_call_id?: string
	tool_calls?: ToolCall[] | null
	tool_name?: string
	timestamp?: number
	reasoning?: string | null
	reasoning_content?: string | null
	finish_reason?: string | null
	display_kind?: string
}

export type Job = {
	id: string
	name: string
	prompt: string
	schedule: string | { kind?: string; expr?: string; display?: string; [k: string]: unknown }
	schedule_display?: string
	deliver?: string
	skills?: string[]
	repeat?: { times?: number | null; completed?: number } | number | null
	enabled?: boolean
	state?: string
	paused?: boolean
	paused_reason?: string | null
	next_run_at?: string | null
	last_run_at?: string | null
	last_status?: string | null
	last_error?: string | null
	created_at?: string
	[k: string]: unknown
}

export type ApprovalRequest = {
	run_id: string
	request_id?: string
	execution_generation?: number
	command?: string
	description?: string
	pattern_key?: string
	choices?: string[]
	[k: string]: unknown
}

export type RunStatus = {
	run_id: string
	status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled' | string
	approval?: ApprovalRequest
	pending_controls?: Array<{
		kind: string
		prompt_id?: string
		execution_generation?: number
		command?: string
		description?: string
		choices?: string[]
	}>
	[k: string]: unknown
}

/** The approval a run is waiting on, in the shape `approve` takes. */
export function pendingApproval(status: RunStatus | null | undefined): ApprovalRequest | undefined {
	if (status?.status !== 'waiting_for_approval') return
	const c = status.pending_controls?.find((x) => x.kind === 'approval')
	if (c) {
		const { prompt_id, kind: _, ...rest } = c
		return { ...rest, run_id: status.run_id, ...(prompt_id ? { request_id: prompt_id } : {}) }
	}
	return status.approval ? { ...status.approval, run_id: status.run_id } : undefined
}

export type ChatEvent =
	| { type: 'run.started'; run_id: string; session_id: string }
	| { type: 'assistant.delta'; delta: string }
	| { type: 'assistant.commentary'; text: string }
	| { type: 'reasoning'; delta: string }
	| { type: 'tool.started'; tool: string; preview?: string; args?: unknown }
	| { type: 'tool.completed'; tool: string; preview?: string; failed: boolean }
	| { type: 'approval.request'; request: ApprovalRequest }
	| { type: 'assistant.completed'; content: string }
	| { type: 'run.finished'; status: 'completed' | 'failed' | 'cancelled'; usage?: any; error?: string }
	| { type: 'error'; message: string }
	| { type: 'status'; text: string }

export const gateway = {
	health: () => get<{ status: string; version?: string }>(`${GW}/health`),
	capabilities: () => get(`${GW}/v1/capabilities`),
	models: () => get<{ data: { id: string }[] }>(`${GW}/v1/models`),

	sessions: (p: { limit?: number; offset?: number; source?: string; title?: string; include_hidden?: boolean } = {}) =>
		get<{ data: Session[]; has_more: boolean }>(`${GW}/api/sessions${qs(p)}`),
	session: (id: string) => get<{ session: Session } | Session>(`${GW}/api/sessions/${enc(id)}`).then(unwrapSession),
	createSession: (body: { title?: string; system_prompt?: string; model?: string } = {}) =>
		post<{ session: Session }>(`${GW}/api/sessions`, body).then((r) => r.session),
	updateSession: (id: string, body: Partial<Pick<Session, 'title' | 'pinned' | 'archived' | 'hidden'>>) =>
		patch(`${GW}/api/sessions/${enc(id)}`, body),
	deleteSession: (id: string) => del(`${GW}/api/sessions/${enc(id)}`),
	forkSession: (id: string, title?: string) =>
		post<{ session: Session }>(`${GW}/api/sessions/${enc(id)}/fork`, title ? { title } : {}).then((r) => r.session),
	messages: (id: string) =>
		get<{ data: Message[] }>(`${GW}/api/sessions/${enc(id)}/messages${qs({ limit: 500, order: 'oldest' })}`).then(
			(r) => r.data,
		),

	/** Runs streaming through this Caduceus server right now, by session id (any tab or device). */
	activeRuns: () => get<Record<string, string>>('ui-api/runs'),
	run: (runId: string) => get<RunStatus>(`${GW}/v1/runs/${enc(runId)}`),
	stopRun: (runId: string) => post(`${GW}/v1/runs/${enc(runId)}/stop`),
	steer: (runId: string, input: string) => post(`${GW}/v1/runs/${enc(runId)}/steer`, { input }),
	approve: (req: ApprovalRequest, choice: string) =>
		post(`${GW}/v1/runs/${enc(req.run_id)}/approval`, {
			choice,
			...(req.request_id ? { request_id: req.request_id } : {}),
			...(req.execution_generation !== undefined ? { execution_generation: req.execution_generation } : {}),
		}),

	jobs: () => get<{ jobs: Job[] }>(`${GW}/api/jobs${qs({ include_disabled: true })}`).then((r) => r.jobs),
	createJob: (body: Partial<Job>) => post<{ job: Job }>(`${GW}/api/jobs`, body).then((r) => r.job),
	updateJob: (id: string, body: Partial<Job>) =>
		patch<{ job: Job }>(`${GW}/api/jobs/${enc(id)}`, body).then((r) => r.job),
	deleteJob: (id: string) => del(`${GW}/api/jobs/${enc(id)}`),
	pauseJob: (id: string) => post(`${GW}/api/jobs/${enc(id)}/pause`),
	resumeJob: (id: string) => post(`${GW}/api/jobs/${enc(id)}/resume`),
	runJob: (id: string) => post(`${GW}/api/jobs/${enc(id)}/run`),

	/** Stream one turn of a session. Yields normalized events; abort via signal. */
	async *chat(
		sessionId: string,
		message: string | Array<Record<string, unknown>>,
		opts: { signal?: AbortSignal; model?: string; instructions?: string } = {},
	): AsyncGenerator<ChatEvent> {
		const res = await fetch(url(`${GW}/api/sessions/${enc(sessionId)}/chat/stream`), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify({
				message,
				...(opts.model ? { model: opts.model } : {}),
				...(opts.instructions ? { instructions: opts.instructions } : {}),
			}),
			signal: opts.signal,
		})
		if (!res.ok) throw await toError(res)
		for await (const frame of readSse(res, opts.signal)) {
			let d: any
			try {
				d = JSON.parse(frame.data)
			} catch {
				continue
			}
			const name = frame.event ?? d.event ?? d.type
			switch (name) {
				case 'run.started':
					yield { type: 'run.started', run_id: d.run_id, session_id: d.session_id }
					break
				case 'assistant.delta':
					if (d.delta) yield { type: 'assistant.delta', delta: d.delta }
					break
				case 'assistant.commentary':
					if (!d.already_streamed && d.text) yield { type: 'assistant.commentary', text: d.text }
					break
				case 'tool.progress':
					if (d.delta) yield { type: 'reasoning', delta: d.delta }
					break
				case 'tool.started':
					yield { type: 'tool.started', tool: d.tool_name, preview: d.preview, args: d.args }
					break
				case 'tool.completed':
				case 'tool.failed':
					yield { type: 'tool.completed', tool: d.tool_name, preview: d.preview, failed: name === 'tool.failed' }
					break
				case 'approval.request':
					yield { type: 'approval.request', request: { ...d, run_id: d.run_id } }
					break
				case 'assistant.completed':
					yield { type: 'assistant.completed', content: d.content ?? '' }
					break
				case 'run.completed':
				case 'run.failed':
				case 'run.cancelled':
					yield {
						type: 'run.finished',
						status: name.slice(4) as 'completed' | 'failed' | 'cancelled',
						usage: d.usage,
						error: d.error?.message ?? d.error,
					}
					break
				case 'hermes.status':
					if (d.text) yield { type: 'status', text: d.text }
					break
				case 'error':
					yield { type: 'error', message: d.message ?? 'The run failed.' }
					break
			}
		}
	},
}

function enc(s: string) {
	return encodeURIComponent(s)
}

function unwrapSession(r: any): Session {
	return (r?.session ?? r) as Session
}

/** Flatten multimodal content into display text. */
export function contentText(c: Message['content']): string {
	if (c == null) return ''
	if (typeof c === 'string') return c
	return c
		.map((p) => (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text' ? (p.text ?? '') : ''))
		.filter(Boolean)
		.join('\n')
}

export function contentImages(c: Message['content']): string[] {
	if (!Array.isArray(c)) return []
	return c
		.filter((p) => p.type === 'image_url' || p.type === 'input_image')
		.map((p) => (typeof p.image_url === 'string' ? p.image_url : (p.image_url?.url ?? '')))
		.filter(Boolean)
}
