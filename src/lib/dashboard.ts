import { DASH, get, post, put, patch, del, qs, request } from './http'

/** Hermes dashboard REST API (config, skills, kanban, webhooks, search, projects). */

export type Skill = {
	name: string
	description: string
	category: string | null
	enabled: boolean
	usage: number
	provenance: 'hub' | 'bundled' | 'external' | 'agent' | string
}

export type HubSkill = {
	name: string
	description: string
	source?: string
	identifier: string
	trust_level?: string
	repo?: string
	tags?: string[]
	category?: string
	installed?: boolean
}

export type Webhook = {
	name: string
	description?: string
	events: string[]
	deliver: string
	deliver_only?: boolean
	prompt?: string
	script?: string
	skills?: string[]
	created_at?: string
	url: string
	secret_set?: boolean
	enabled: boolean
}

export type KanbanTask = {
	id: string
	title: string
	body?: string | null
	assignee?: string | null
	status: string
	priority: number
	created_at?: number
	started_at?: number | null
	completed_at?: number | null
	tenant?: string | null
	result?: string | null
	skills?: string[] | null
	session_id?: string | null
	latest_summary?: string | null
	comment_count?: number
	progress?: { done: number; total: number } | null
	link_counts?: { parents: number; children: number }
	last_failure_error?: string | null
	[k: string]: unknown
}

export type KanbanBoard = {
	slug: string
	name: string
	description?: string
	icon?: string
	color?: string
	is_current?: boolean
	counts?: Record<string, number>
	total?: number
}

export type SchemaField = {
	type: 'string' | 'number' | 'boolean' | 'list' | 'select' | string
	description?: string
	category?: string
	options?: string[]
}

export type DashSession = {
	id: string
	source: string
	title: string | null
	model?: string
	preview?: string
	started_at?: number
	last_active?: number
	message_count?: number
	is_active?: boolean
	cwd?: string | null
	archived?: boolean
	pinned?: boolean
}

export type SearchHit = {
	session_id: string
	snippet: string
	role?: string
	source?: string
	title?: string | null
	model?: string
	last_active?: number
	started_at?: number
	message_count?: number
	preview?: string
}

const K = `${DASH}/api/plugins/kanban`

export const dashboard = {
	status: () => get(`${DASH}/api/status`),
	modelInfo: () => get(`${DASH}/api/model/info`),
	modelOptions: () =>
		get<{
			providers: { slug: string; name: string; is_current?: boolean; models: string[] }[]
			model: string
			provider: string
		}>(`${DASH}/api/model/options`),
	setModel: (provider: string, model: string) => post(`${DASH}/api/model/set`, { scope: 'main', provider, model }),

	// Sessions (richer than the gateway: full-text search, sources)
	sessions: (
		p: {
			limit?: number
			offset?: number
			source?: string
			order?: 'recent' | 'created'
			archived?: 'exclude' | 'only' | 'include'
		} = {},
	) => get<{ sessions: DashSession[]; total: number }>(`${DASH}/api/sessions${qs(p)}`),
	search: (q: string, limit = 30) =>
		get<{ results: SearchHit[] }>(`${DASH}/api/sessions/search${qs({ q, limit })}`).then((r) => r.results),
	sessionStats: () => get(`${DASH}/api/sessions/stats`),
	projectsTree: () => get<{ projects: any[] }>(`${DASH}/api/profiles/projects/tree${qs({ preview_limit: 5 })}`),

	// Config
	config: () => get<Record<string, any>>(`${DASH}/api/config`),
	saveConfig: (config: Record<string, any>) => put(`${DASH}/api/config`, { config }),
	schema: () => get<{ fields: Record<string, SchemaField>; category_order: string[] }>(`${DASH}/api/config/schema`),
	env: () =>
		get<
			Record<
				string,
				{
					is_set: boolean
					redacted_value?: string
					description?: string
					category?: string
					is_password?: boolean
					url?: string
					advanced?: boolean
				}
			>
		>(`${DASH}/api/env`),
	setEnv: (key: string, value: string) => put(`${DASH}/api/env`, { key, value }),
	deleteEnv: (key: string) => request(`${DASH}/api/env`, { method: 'DELETE', json: { key } }),

	// Skills
	skills: () => get<Skill[]>(`${DASH}/api/skills`),
	toggleSkill: (name: string, enabled: boolean) => put(`${DASH}/api/skills/toggle`, { name, enabled }),
	skillContent: (name: string) =>
		get<{ name: string; content: string; path: string }>(`${DASH}/api/skills/content${qs({ name })}`),
	saveSkillContent: (name: string, content: string) => put(`${DASH}/api/skills/content`, { name, content }),
	createSkill: (name: string, content: string, category?: string) =>
		post(`${DASH}/api/skills`, { name, content, category }),
	hubSearch: (q: string) =>
		get<{ results: HubSkill[] }>(`${DASH}/api/skills/hub/search${qs({ q, source: 'all', limit: 20 })}`),
	hubOfficial: () => get<{ skills: HubSkill[] }>(`${DASH}/api/skills/hub/official`),
	hubInstall: (identifier: string) =>
		post<{ ok: boolean; name: string }>(`${DASH}/api/skills/hub/install`, { identifier }),
	hubUninstall: (name: string) => post<{ ok: boolean; name: string }>(`${DASH}/api/skills/hub/uninstall`, { name }),
	actionStatus: (name: string) =>
		get<{ running?: boolean; exit_code?: number | null; lines?: string[]; [k: string]: any }>(
			`${DASH}/api/actions/${encodeURIComponent(name)}/status${qs({ lines: 200 })}`,
		),

	// Webhooks
	webhooks: () => get<{ enabled: boolean; base_url: string; subscriptions: Webhook[] }>(`${DASH}/api/webhooks`),
	enableWebhooks: () => post<{ ok: boolean; needs_restart?: boolean }>(`${DASH}/api/webhooks/enable`),
	createWebhook: (body: {
		name: string
		description?: string
		events?: string[]
		prompt?: string
		skills?: string[]
		deliver?: string
		deliver_only?: boolean
		deliver_chat_id?: string
		secret?: string
	}) => post<Webhook & { secret?: string }>(`${DASH}/api/webhooks`, body),
	deleteWebhook: (name: string) => del(`${DASH}/api/webhooks/${encodeURIComponent(name)}`),
	setWebhookEnabled: (name: string, enabled: boolean) =>
		put(`${DASH}/api/webhooks/${encodeURIComponent(name)}/enabled`, { enabled }),
	deliveryTargets: () =>
		get<{ targets: { id: string; name: string; home_target_set?: boolean }[] }>(
			`${DASH}/api/cron/delivery-targets`,
		).then((r) => r.targets),
	jobRuns: (id: string) =>
		get<{ runs: any[] }>(`${DASH}/api/cron/jobs/${encodeURIComponent(id)}/runs${qs({ limit: 20 })}`).then(
			(r) => r.runs,
		),

	// Kanban
	boards: () => get<{ boards: KanbanBoard[]; current: string }>(`${K}/boards`),
	createBoard: (body: { slug: string; name?: string; description?: string }) => post(`${K}/boards`, body),
	board: (board?: string) =>
		get<{ columns: { name: string; tasks: KanbanTask[] }[]; assignees: string[]; tenants: string[] }>(
			`${K}/board${qs({ board })}`,
		),
	task: (id: string, board?: string) =>
		get<{ task: KanbanTask; comments: any[]; events: any[]; runs: any[] }>(
			`${K}/tasks/${encodeURIComponent(id)}${qs({ board })}`,
		),
	createTask: (body: Partial<KanbanTask> & { title: string; triage?: boolean }, board?: string) =>
		post<{ task: KanbanTask; warning?: string }>(`${K}/tasks${qs({ board })}`, body),
	updateTask: (id: string, body: Record<string, unknown>, board?: string) =>
		patch<{ task: KanbanTask }>(`${K}/tasks/${encodeURIComponent(id)}${qs({ board })}`, body),
	deleteTask: (id: string, board?: string) => del(`${K}/tasks/${encodeURIComponent(id)}${qs({ board })}`),
	commentTask: (id: string, body: string, board?: string) =>
		post(`${K}/tasks/${encodeURIComponent(id)}/comments${qs({ board })}`, { body, author: 'Caduceus' }),
	assignees: (board?: string) => get<{ assignees: string[] }>(`${K}/assignees${qs({ board })}`),
}
