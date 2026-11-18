/**
 * Replying to a schedule's run. Hermes keeps a scheduled job's chat for that job alone: a message typed into it is
 * refused (`cron_session_read_only`), never run. So a reply goes to a chat of its own for the job, a plain chat named
 * after it, and the first message there for a run carries what the run produced, so the agent knows what is meant.
 */
import { contentText, type Job, type Message } from './gateway'

/** The code Hermes refuses a message typed into a schedule's chat with. */
export const SCHEDULE_REFUSAL = 'cron_session_read_only'

/** How much of a run's output the reply carries. */
export const OUTPUT_CAP = 4000

/** A chat a schedule's run wrote: History lists it under the "Schedule" channel. */
export function isScheduleChat(s: { source?: string | null } | null | undefined): boolean {
	return s?.source === 'cron'
}

/**
 * Hermes refused a message because its chat belongs to a schedule: an `ApiError`, a failed run's error, or the
 * `error_surface` Hermes settles such a turn with.
 */
export function isScheduleRefusal(e: unknown): boolean {
	if (!e || typeof e !== 'object') return false
	const x = e as { code?: unknown; error?: unknown; error_surface?: unknown }
	if (x.code === SCHEDULE_REFUSAL) return true
	return [x.error, x.error_surface].some(
		(v) => !!v && typeof v === 'object' && (v as { code?: unknown }).code === SCHEDULE_REFUSAL,
	)
}

// Hermes titles a run's chat `<job name> · <Mon DD HH:MM>`, with ` #2`… when that title is taken, and `cron <job id>`
// when it has nothing better.
const RUN_TITLE = /^(.+?) · [A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}(?: #\d+)?$/
const BARE_TITLE = /^cron (\S+)$/

/** The job a run's chat belongs to, by name, read off the title Hermes gave it. */
export function scheduleJobName(title: string | null | undefined, jobs: Pick<Job, 'id' | 'name'>[] = []): string {
	const t = title?.trim() ?? ''
	const named = RUN_TITLE.exec(t)
	if (named) return named[1]!.trim()
	const bare = BARE_TITLE.exec(t)
	if (bare) return jobs.find((j) => j.id === bare[1])?.name?.trim() || t
	return t || 'Scheduled job'
}

/** Whether the job's name has to be looked up among the jobs: the title only names the job's id. */
export function needsJobLookup(title: string | null | undefined): boolean {
	return BARE_TITLE.test(title?.trim() ?? '')
}

/** The title of the chat that replies to a job's runs go to; one per job. */
export function replyChatTitle(jobName: string): string {
	return `Reply to ${jobName.trim() || 'Scheduled job'}`
}

/**
 * What the run produced: the agent's last words before anyone typed into its chat (the job's own prompt is the
 * chat's first message; messages after it were typed in and refused). Falls back to the last words at all.
 */
export function runOutput(messages: Message[]): string {
	const shown = messages.filter((m) => m.role !== 'system' && m.display_kind !== 'hidden')
	const first = shown.findIndex((m) => m.role === 'user')
	const typed = first < 0 ? -1 : shown.findIndex((m, i) => i > first && m.role === 'user')
	const run = typed < 0 ? shown : shown.slice(0, typed)
	const said = (ms: Message[]) => {
		for (let i = ms.length - 1; i >= 0; i--) {
			const m = ms[i]!
			const text = m.role === 'assistant' ? contentText(m.content).trim() : ''
			if (text) return text
		}
		return ''
	}
	return said(run) || said(shown)
}

/**
 * At most `cap` characters of a run's output. A long one keeps its start and, mostly, its end, where a job usually
 * asks what to do next.
 */
export function capOutput(text: string, cap = OUTPUT_CAP): string {
	const t = text.trim()
	if (t.length <= cap) return t
	const cut = (n: number) => `\n\n[… ${n} characters left out …]\n\n`
	// Room for the marker, sized for the largest number it could show.
	const room = cap - cut(t.length).length
	const head = Math.floor(room * 0.3)
	const tail = room - head
	return t.slice(0, head).trimEnd() + cut(t.length - head - tail) + t.slice(t.length - tail).trimStart()
}

export const REPLY_DIVIDER = '---'

/** The line naming the run a reply is about. It also tells whether a reply chat already has a run's context. */
export function runMarker(runChatId: string) {
	return `(run chat ${runChatId})`
}

export type RunContext = {
	jobName: string
	/** When the run happened, as the reader should see it. */
	ranAt?: string
	runChatId: string
	output: string
}

/**
 * The first message about a run in its job's reply chat: which job and run it is about, what the run produced
 * (capped), a divider, then what the user wrote.
 */
export function withRunContext(ctx: RunContext, message: string, cap = OUTPUT_CAP): string {
	const when = ctx.ranAt ? ` from ${ctx.ranAt}` : ''
	const header = `This replies to the run${when} of the scheduled job "${ctx.jobName}" ${runMarker(ctx.runChatId)}.`
	const output = capOutput(ctx.output, cap)
	const body = output ? `What the run produced:\n\n${output}` : 'The run produced no text.'
	return `${header}\n${body}\n\n${REPLY_DIVIDER}\n\n${message}`
}

/** Whether a reply chat already holds a run's context: then a message goes out as written. */
export function hasRunContext(userTexts: string[], runChatId: string): boolean {
	const marker = runMarker(runChatId)
	return userTexts.some((t) => t.includes(marker))
}
