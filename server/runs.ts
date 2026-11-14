import { Elysia } from 'elysia'
import { randomUUID } from 'node:crypto'

/**
 * Chat streams that pass through the relay, kept so a browser can rejoin one.
 *
 * Hermes interrupts a chat run when its stream disconnects, so a reload, a closed tab or a phone putting the app to
 * sleep would kill the run. The relay therefore reads every chat stream to its end itself, whatever the browser does,
 * and keeps its events, numbered. The browser gets them with `id: <n>` and the stream's key in `X-Caduceus-Stream`;
 * when its connection drops it rejoins with `GET /ui-api/runs/streams/<key>?after=<n>` and gets what it missed, then
 * the rest live. A stream is kept until a while after it ends.
 *
 * It also answers which runs are going on through this relay (`GET /ui-api/runs`): Hermes has no "active run of a
 * session" lookup, so a second tab or device opening a running chat could otherwise only show a stale transcript.
 */

type Stream = {
	key: string
	sessionId: string
	/** The bot whose gateway runs it; `default` for Hermes itself. */
	profile: string
	runId?: string
	/** Every event frame so far, as Hermes wrote it; the index is its number. */
	frames: string[]
	done: boolean
	/** Readers waiting for more. */
	wake: Set<() => void>
}

// Kept this long after a stream ends, for a browser that comes back late.
const KEEP_MS = 5 * 60_000
const PING_MS = 20_000

const streams = new Map<string, Stream>()
/** The stream of each session's run going on now. */
const running = new Map<string, Stream>()

// Bots' chats go through `/p/<profile>/` on the multiplexed gateway.
const CHAT_STREAM = /^(?:\/p\/([^/]+))?\/api\/sessions\/([^/]+)\/chat\/stream$/

export const isChatStream = (path: string) => CHAT_STREAM.test(path)

/** What a chat stream through the relay says that matters while nobody looks: notifications hear of it. */
export type StreamNews =
	| { type: 'started'; sessionId: string; profile: string }
	| { type: 'approval'; sessionId: string; profile: string; detail: string }
	| { type: 'finished'; sessionId: string; profile: string; status: string; text: string; error?: string }

const observers = new Set<(news: StreamNews) => void>()
export function onChatStream(fn: (news: StreamNews) => void) {
	observers.add(fn)
}
function tell(news: StreamNews) {
	for (const fn of observers) {
		try {
			fn(news)
		} catch {}
	}
}

const NEWS = /approval\.request|assistant\.completed|run\.(?:completed|failed|cancelled)/

/** A frame's event name and data, when it is one notifications care about. */
function newsOf(frame: string): { name: string; data: any } | null {
	if (!NEWS.test(frame)) return null
	let name: string | undefined
	const data: string[] = []
	for (const line of frame.split(/\r?\n/)) {
		if (line.startsWith('event:')) name = line.slice(6).trim()
		else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
	}
	try {
		const d = JSON.parse(data.join('\n'))
		return { name: name ?? d.event ?? d.type ?? '', data: d }
	} catch {
		return null
	}
}

const HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }

/** Take over a chat stream: the relay reads it to the end; the browser reads the relay's numbered copy. */
export function trackChatStream(path: string, res: Response): Response {
	const m = path.match(CHAT_STREAM)
	if (!m || !res.ok || !res.body) return res
	const stream: Stream = {
		key: randomUUID(),
		sessionId: decodeURIComponent(m[2]!),
		profile: m[1] ? decodeURIComponent(m[1]) : 'default',
		frames: [],
		done: false,
		wake: new Set(),
	}
	streams.set(stream.key, stream)
	void read(stream, res.body)
	return new Response(follow(stream, -1), { headers: { ...HEADERS, 'X-Caduceus-Stream': stream.key } })
}

async function read(stream: Stream, body: ReadableStream) {
	const reader = body.pipeThrough(new TextDecoderStream()).getReader()
	let buf = ''
	const who = { sessionId: stream.sessionId, profile: stream.profile }
	let reply = ''
	let finished = false
	tell({ type: 'started', ...who })
	const add = (frame: string) => {
		// Comments (keepalives) carry nothing to replay.
		if (!frame.split(/\r?\n/).some((line) => line && !line.startsWith(':'))) return
		stream.frames.push(frame)
		const news = newsOf(frame)
		if (news?.name === 'approval.request')
			tell({ type: 'approval', ...who, detail: String(news.data.command ?? news.data.description ?? '') })
		else if (news?.name === 'assistant.completed') reply = String(news.data.content ?? '')
		else if (news && /^run\.(?:completed|failed|cancelled)$/.test(news.name)) {
			finished = true
			const error = news.data.error?.message ?? news.data.error
			tell({
				type: 'finished',
				...who,
				status: news.name.slice(4),
				text: reply,
				error: error ? String(error) : undefined,
			})
		}
		if (!stream.runId) {
			const hit = frame.match(/"run_id"\s*:\s*"([^"]+)"/)
			if (hit) {
				stream.runId = hit[1]!
				running.set(stream.sessionId, stream)
			}
		}
	}
	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) break
			buf += value
			let at: number
			while ((at = buf.search(/\r?\n\r?\n/)) !== -1) {
				add(buf.slice(0, at))
				buf = buf.slice(at).replace(/^\r?\n\r?\n/, '')
			}
			wakeAll(stream)
		}
		if (buf.trim()) add(buf)
	} catch {
		// Hermes went away mid-stream: what arrived stays readable, and the stream ends here.
	} finally {
		if (!finished) tell({ type: 'finished', ...who, status: 'lost', text: reply })
		stream.done = true
		if (running.get(stream.sessionId) === stream) running.delete(stream.sessionId)
		wakeAll(stream)
		setTimeout(() => streams.delete(stream.key), KEEP_MS)
	}
}

function wakeAll(stream: Stream) {
	for (const fn of [...stream.wake]) fn()
}

/** The stream's frames after `after`, each with its number as its id, then new ones as they come. */
function follow(stream: Stream, after: number): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	let next = after + 1
	let ping: ReturnType<typeof setInterval> | undefined
	let wake: (() => void) | undefined
	const stop = () => {
		clearInterval(ping)
		if (wake) stream.wake.delete(wake)
	}
	return new ReadableStream({
		start(controller) {
			const flush = () => {
				try {
					while (next < stream.frames.length) {
						// The id goes last: it is the one a reader keeps if Hermes' frame has its own.
						controller.enqueue(encoder.encode(`${stream.frames[next]}\nid: ${next}\n\n`))
						next++
					}
					if (stream.done) {
						stop()
						controller.close()
					}
				} catch {
					stop()
				}
			}
			wake = flush
			stream.wake.add(flush)
			ping = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'))
				} catch {
					stop()
				}
			}, PING_MS)
			flush()
		},
		cancel: stop,
	})
}

export const runRoutes = new Elysia()
	.get('/ui-api/runs', () =>
		Object.fromEntries([...running].flatMap(([sessionId, s]) => (s.runId ? [[sessionId, s.runId]] : []))),
	)
	.get('/ui-api/runs/streams/:key', ({ params, query, set }) => {
		const stream = streams.get(params.key)
		if (!stream) {
			set.status = 404
			return { error: { message: 'This reply is no longer kept. Its chat has it.', code: 'stream_gone' } }
		}
		const after = Number(query.after ?? -1)
		return new Response(follow(stream, Number.isInteger(after) ? after : -1), { headers: HEADERS })
	})
