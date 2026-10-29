import { contentImages, contentText, type Message } from './gateway'

/**
 * A conversation is rendered as turns. An agent turn is the route the agent took
 * between two user messages: text it wrote and the tools it called, in order.
 */
export type ToolStep = {
	kind: 'tool'
	id?: string
	name: string
	args?: Record<string, unknown> | null
	preview?: string | null
	output?: string | null
	status: 'running' | 'done' | 'failed'
}
export type TextStep = { kind: 'text'; text: string }
export type ApprovalStep = {
	kind: 'approval'
	command?: string
	description?: string
	choices: string[]
	resolved?: string
}
export type Step = ToolStep | TextStep | ApprovalStep

export type UserTurn = { kind: 'user'; key: string; text: string; images: string[]; at?: number }
export type AgentTurn = {
	kind: 'agent'
	key: string
	steps: Step[]
	reasoning: string
	at?: number
	live?: boolean
	error?: string
}
export type Turn = UserTurn | AgentTurn

function parseArgs(raw: unknown): Record<string, unknown> | null {
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>
	if (typeof raw !== 'string' || !raw) return null
	try {
		const v = JSON.parse(raw)
		return v && typeof v === 'object' ? v : { value: v }
	} catch {
		return { value: raw }
	}
}

export function buildTurns(messages: Message[]): Turn[] {
	const turns: Turn[] = []
	let agent: AgentTurn | null = null
	const byCallId = new Map<string, ToolStep>()

	for (const m of messages) {
		if (m.display_kind === 'hidden' || m.role === 'system') continue
		if (m.role === 'user') {
			agent = null
			turns.push({
				kind: 'user',
				key: `u${m.id ?? turns.length}`,
				text: contentText(m.content),
				images: contentImages(m.content),
				at: num(m.timestamp),
			})
			continue
		}
		if (!agent) {
			agent = { kind: 'agent', key: `a${m.id ?? turns.length}`, steps: [], reasoning: '', at: num(m.timestamp) }
			turns.push(agent)
		}
		if (m.role === 'assistant') {
			const r = m.reasoning_content || m.reasoning
			if (r) agent.reasoning += (agent.reasoning ? '\n\n' : '') + r
			const text = contentText(m.content).trim()
			if (text) agent.steps.push({ kind: 'text', text })
			for (const call of m.tool_calls ?? []) {
				const step: ToolStep = {
					kind: 'tool',
					id: call.id,
					name: call.function?.name ?? 'tool',
					args: parseArgs(call.function?.arguments),
					status: 'running',
				}
				if (call.id) byCallId.set(call.id, step)
				agent.steps.push(step)
			}
		} else if (m.role === 'tool') {
			const step = (m.tool_call_id && byCallId.get(m.tool_call_id)) || undefined
			const output = contentText(m.content)
			if (step) {
				step.output = output
				step.status = looksFailed(output) ? 'failed' : 'done'
			} else {
				agent.steps.push({ kind: 'tool', name: m.tool_name ?? 'tool', output, status: 'done' })
			}
		}
	}
	// Calls whose results never arrived (interrupted turn) are not still running.
	for (const s of byCallId.values()) if (s.status === 'running') s.status = 'done'
	return turns
}

function num(v: unknown) {
	const n = typeof v === 'string' ? parseFloat(v) : (v as number)
	return Number.isFinite(n) ? n : undefined
}

function looksFailed(output: string) {
	const head = output.slice(0, 200)
	return /^\s*\{\s*"(success)"\s*:\s*false/.test(head) || /^\s*\{\s*"error"\s*:/.test(head)
}

/** One line that says what a tool call did, for the collapsed route. */
export function toolSummary(step: ToolStep): string {
	const a = step.args ?? {}
	const pick = (...keys: string[]) => {
		for (const k of keys) {
			const v = a[k]
			if (typeof v === 'string' && v.trim()) return v.trim()
		}
		return ''
	}
	const s =
		pick('command', 'cmd', 'code') ||
		pick('path', 'file_path', 'filename', 'file') ||
		pick('query', 'q', 'url', 'pattern') ||
		pick('name', 'skill', 'task', 'goal', 'prompt', 'text', 'content') ||
		step.preview ||
		Object.values(a).find((v): v is string => typeof v === 'string') ||
		''
	return s.replace(/\s+/g, ' ').slice(0, 160)
}

export function prettyToolName(name: string) {
	return name.replace(/^mcp_/, '').replace(/_/g, ' ')
}

export function finalText(turn: AgentTurn) {
	const texts = turn.steps.filter((s): s is TextStep => s.kind === 'text')
	return texts.at(-1)?.text ?? ''
}
