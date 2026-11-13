import type { AgentTurn, ClarifyStep, ToolStep } from './turns'
import type { WatchEvent } from './bot-watch'
import type { RunClock } from './run-stats'

/** An approval a Bot Chat's turn asks for, answered on the Hermes socket. */
export type SocketPrompt = { generation: number; id: string; command?: string; description?: string; choices: string[] }

/** What an event means beyond the turn's own steps, for whoever shows the turn. */
export type Outcome = {
	status?: string
	prompt?: SocketPrompt
	/** The approval with this id was answered elsewhere or ran out. */
	settled?: string
	/** The view fell behind and Hermes dropped it. */
	gap?: true
	/** The turn ended. */
	complete?: true
}

/**
 * Writes a live agent turn as its events arrive. Tokens come faster than the screen refreshes, so text and
 * reasoning are collected and applied once per frame; anything else lands after the text before it.
 */
export class TurnWriter {
	private written = ''
	private thought = ''
	private frame = 0

	constructor(
		readonly turn: AgentTurn,
		private clock: RunClock | null = null,
	) {}

	/** Reply text streaming in. */
	text(delta: string) {
		if (!delta) return
		this.clock?.output()
		this.written += delta
		this.later()
	}

	/** Reasoning: `streamed` as it is written, else a finished block that arrived after it was written. */
	reasoning(text: string, streamed: boolean) {
		if (!text) return
		this.clock?.output(streamed)
		this.thought += text
		this.later()
	}

	/** Text the agent wrote beside its tool calls, as a step of its own. */
	commentary(text: string) {
		this.flush()
		if (!text) return
		this.clock?.output()
		this.turn.steps.push({ kind: 'text', text })
	}

	toolStarted(step: Omit<ToolStep, 'kind' | 'status'>) {
		this.flush()
		this.clock?.toolStarted()
		this.turn.steps.push({ kind: 'tool', status: 'running', ...step })
	}

	toolDone(match: { id?: string; name?: string }, failed: boolean, output?: string) {
		this.flush()
		this.clock?.toolDone()
		const step = [...this.turn.steps]
			.reverse()
			.find(
				(s): s is ToolStep =>
					s.kind === 'tool' && s.status === 'running' && (match.id ? s.id === match.id : s.name === match.name),
			)
		if (!step) return
		step.status = failed ? 'failed' : 'done'
		if (output !== undefined) step.output = output
	}

	flush() {
		cancelAnimationFrame(this.frame)
		this.frame = 0
		if (this.written) {
			const last = this.turn.steps.at(-1)
			if (last?.kind === 'text') last.text += this.written
			else {
				const t = this.written.replace(/^\s+/, '')
				if (t) this.turn.steps.push({ kind: 'text', text: t })
			}
			this.written = ''
		}
		if (this.thought) {
			this.turn.reasoning += this.thought
			this.thought = ''
		}
	}

	private later() {
		if (!this.frame) this.frame = requestAnimationFrame(() => this.flush())
	}

	/** Show a clarify question, once however often it is reported. */
	ask(step: ClarifyStep) {
		this.flush()
		if (this.turn.steps.some((s) => s.kind === 'clarify' && s.id === step.id)) return
		this.turn.steps.push(step)
	}

	/** A clarify question was answered somewhere else or ran out: it can no longer be answered here. */
	clarifySettled(id: string) {
		const step = this.turn.steps.find((s): s is ClarifyStep => s.kind === 'clarify' && s.id === id)
		if (step && step.answer === undefined) step.answer = 'elsewhere'
	}

	/**
	 * Apply one event a viewer of a Bot Chat gets on the Hermes socket. `where` names the chat on that socket, so a
	 * clarify question can be answered there.
	 */
	apply(ev: WatchEvent, where?: { profile: string; session: string }): Outcome {
		const p = ev.payload ?? {}
		const text = typeof p.text === 'string' ? p.text : ''
		switch (ev.type) {
			case 'message.start':
				this.clock?.turnStarted()
				return {}
			case 'message.delta':
				this.text(text)
				return {}
			case 'reasoning.delta':
				this.reasoning(text, true)
				return {}
			case 'reasoning.available':
				// A finished block, from a model that does not stream its reasoning.
				if (text && !this.thought && !this.turn.reasoning.endsWith(text))
					this.reasoning((this.turn.reasoning ? '\n\n' : '') + text, false)
				return {}
			case 'message.interim':
				if (!p.already_streamed) this.commentary(text)
				return {}
			case 'tool.start':
				this.toolStarted({
					id: p.tool_id ?? p.tool_call_id,
					name: p.name ?? p.tool_name ?? 'tool',
					preview: p.context ?? null,
					args: p.args && typeof p.args === 'object' ? p.args : null,
				})
				return {}
			case 'tool.complete':
				this.toolDone(
					{ id: p.tool_id ?? p.tool_call_id, name: p.name },
					!!p.is_error,
					typeof p.result_text === 'string' ? p.result_text : typeof p.result === 'string' ? p.result : undefined,
				)
				return {}
			case 'status.update':
				return text ? { status: text } : {}
			case 'approval.request': {
				this.flush()
				const generation = ev.generation ?? p.execution_generation
				if (typeof generation !== 'number' || !p.prompt_id) return {}
				const choices: string[] = p.choices ?? ['once', 'session', 'always', 'deny']
				this.turn.steps.push({ kind: 'approval', command: p.command, description: p.description, choices })
				return {
					prompt: { generation, id: p.prompt_id, command: p.command, description: p.description, choices },
				}
			}
			case 'approval.settled':
				return p.prompt_id ? { settled: p.prompt_id } : {}
			case 'clarify.request': {
				const generation = ev.generation ?? p.execution_generation
				if (typeof generation !== 'number' || !p.prompt_id || !where) return {}
				this.ask({
					kind: 'clarify',
					id: p.prompt_id,
					question: p.question ?? '',
					choices: Array.isArray(p.choices) ? p.choices : [],
					multiSelect: !!p.multi_select,
					via: { ...where, generation },
				})
				return {}
			}
			case 'clarify.settled':
				if (p.prompt_id) this.clarifySettled(p.prompt_id)
				return {}
			case 'message.complete':
				this.flush()
				if (p.status === 'error' && typeof p.error === 'string' && p.error) this.turn.error = p.error
				return { complete: true }
			case 'session.replay_gap':
				return { gap: true }
		}
		return {}
	}

	/** Mark the open approval answered (`elsewhere` when not from here). */
	resolve(choice: string) {
		const step = [...this.turn.steps].reverse().find((s) => s.kind === 'approval' && !s.resolved)
		if (step?.kind === 'approval') step.resolved = choice
	}
}
