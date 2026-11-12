import type { Session } from './gateway'

/**
 * How fast one turn ran: measured in this tab while it streamed, with token counts from Hermes' session
 * counters. Hermes reports no timings of its own, so the split between reading the prompt and writing the
 * reply comes from when output started arriving.
 */
export type RunStats = {
	/** Sending the message to the end of the reply. */
	totalMs: number
	/** Prompt tokens the model read (cached ones excluded) and the time before its output started. */
	promptTokens?: number
	cachedTokens?: number
	promptMs?: number
	/** Tokens the model wrote, reasoning included, and the time it spent writing them. */
	outputTokens?: number
	genMs?: number
	toolMs?: number
	calls?: number
}

const MIN_MS = 50
// Below this many freshly read prompt tokens (the rest came from the cache), the wait before the reply is mostly
// latency, and a rate would say nothing about how fast the model reads.
const MIN_PROMPT = 1000

export function ppRate(s: RunStats) {
	return s.promptTokens && s.promptTokens >= MIN_PROMPT && s.promptMs && s.promptMs >= MIN_MS
		? (s.promptTokens / s.promptMs) * 1000
		: undefined
}

export function tgRate(s: RunStats) {
	return s.outputTokens && s.genMs && s.genMs >= MIN_MS ? (s.outputTokens / s.genMs) * 1000 : undefined
}

/** Session counters that grow with every model call; their growth over a turn is that turn's usage. */
export type Counters = Pick<
	Session,
	'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'reasoning_tokens' | 'api_call_count'
>

export function counters(s: Session | null | undefined): Counters | null {
	if (!s || typeof s.output_tokens !== 'number') return null
	const { input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, api_call_count } = s
	return { input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, api_call_count }
}

/** The tokens of one turn: the counters' growth, else the run's own usage (prompt tokens there include cached ones). */
export function turnTokens(
	before: Counters | null,
	after: Counters | null,
	usage?: { input_tokens?: number; output_tokens?: number } | null,
): Pick<RunStats, 'promptTokens' | 'cachedTokens' | 'outputTokens' | 'calls'> & { reasoningTokens?: number } {
	const d = (k: keyof Counters) => {
		const a = after?.[k]
		const b = before?.[k]
		return typeof a === 'number' && typeof b === 'number' && a >= b ? a - b : undefined
	}
	const output = d('output_tokens')
	if (before && after && output) {
		return {
			promptTokens: d('input_tokens'),
			cachedTokens: d('cache_read_tokens') || undefined,
			outputTokens: output,
			reasoningTokens: d('reasoning_tokens') || undefined,
			calls: d('api_call_count') || undefined,
		}
	}
	return { promptTokens: usage?.input_tokens || undefined, outputTokens: usage?.output_tokens || undefined }
}

type Timing = Pick<RunStats, 'totalMs' | 'promptMs' | 'genMs' | 'toolMs'> & { sawReasoning: boolean }

/**
 * One turn's stats from its clock and its tokens. Reasoning a model does not stream is written while nothing
 * arrives, which would read as prompt time: it is moved to writing at the speed the visible reply came in.
 */
export function turnStats(t: Timing, k: ReturnType<typeof turnTokens>): RunStats {
	const { sawReasoning, ...timing } = t
	const { reasoningTokens, ...tokens } = k
	const out: RunStats = { ...timing, ...tokens }
	const visible = (k.outputTokens ?? 0) - (reasoningTokens ?? 0)
	if (!sawReasoning && reasoningTokens && visible > 0 && (out.genMs ?? 0) >= MIN_MS) {
		const hiddenMs = Math.min(out.promptMs ?? 0, (reasoningTokens / visible) * out.genMs!)
		out.promptMs = (out.promptMs ?? 0) - hiddenMs
		out.genMs = out.genMs! + hiddenMs
	}
	return out
}

/**
 * The clock of one streaming turn. The agent alternates between model calls and tool runs; within a call the
 * model first reads the prompt (nothing arrives), then writes (text, reasoning or a tool call arrives).
 */
export class RunClock {
	private start = performance.now()
	private segStart: number | undefined = this.start
	private firstOut: number | undefined
	private tools = 0
	private toolsAt = 0
	promptMs = 0
	genMs = 0
	toolMs = 0
	/** Reasoning streamed in, so its time already counts as writing. */
	sawReasoning = false

	/** The turn began running: a Bot Chat's message may first wait behind another turn. */
	turnStarted() {
		if (this.firstOut === undefined && this.tools === 0 && this.genMs === 0) this.segStart = performance.now()
	}

	/** Something the model wrote arrived: text, reasoning, commentary. */
	output(reasoning = false) {
		if (reasoning) this.sawReasoning = true
		if (this.segStart === undefined || this.firstOut !== undefined) return
		const now = performance.now()
		this.promptMs += now - this.segStart
		this.firstOut = now
	}

	/** A tool began: the model call that asked for it is over. */
	toolStarted() {
		const now = performance.now()
		this.closeCall(now)
		if (this.tools++ === 0) this.toolsAt = now
	}

	/** A tool ended; once none run, the next model call begins. */
	toolDone() {
		if (this.tools === 0) return
		if (--this.tools > 0) return
		const now = performance.now()
		this.toolMs += now - this.toolsAt
		this.segStart = now
	}

	/** The turn ended. */
	finish(): Timing {
		const now = performance.now()
		this.closeCall(now)
		if (this.tools) this.toolMs += now - this.toolsAt
		this.tools = 0
		return {
			totalMs: now - this.start,
			promptMs: this.promptMs,
			genMs: this.genMs,
			toolMs: this.toolMs || undefined,
			sawReasoning: this.sawReasoning,
		}
	}

	private closeCall(now: number) {
		if (this.segStart === undefined) return
		if (this.firstOut === undefined) this.promptMs += now - this.segStart
		else this.genMs += now - this.firstOut
		this.segStart = undefined
		this.firstOut = undefined
	}
}

// Kept per reply and per browser, so the line stays after the transcript reloads and across visits.
const KEY = 'caduceus.runStats.v1'
const KEEP = 300
type Saved = Record<string, RunStats & { at: number }>

function read(): Saved {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
	} catch {
		return {}
	}
}

let saved: Saved | null = null

export function savedStats(): Saved {
	return (saved ??= read())
}

export function saveStats(key: string, stats: RunStats) {
	const all = { ...savedStats(), [key]: { ...stats, at: Date.now() } }
	const keys = Object.keys(all)
	if (keys.length > KEEP)
		for (const k of keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - KEEP)) delete all[k]
	saved = all
	try {
		localStorage.setItem(KEY, JSON.stringify(all))
	} catch {
		// Storage full or blocked: the line shows until the page reloads.
	}
}
