import { Elysia } from 'elysia'

/**
 * Runs started through this relay, by session. Hermes has no "active run of a session" lookup, so a
 * second tab or device opening a running chat could only show a stale transcript. The relay sees every
 * chat stream pass through, notes the run id from `run.started`, and forgets it when the stream ends.
 */
const active = new Map<string, { runId: string; startedAt: number }>()

const CHAT_STREAM = /^\/api\/sessions\/([^/]+)\/chat\/stream$/

/**
 * Hermes interrupts a chat run when its stream disconnects, so a reload or a closed tab would kill the
 * run. Chat streams are therefore not tied to the browser request; the relay reads them to the end.
 */
export const isChatStream = (path: string) => CHAT_STREAM.test(path)

/** Watch a chat stream response on the side; the client gets the untouched other half. */
export function trackChatStream(path: string, res: Response): Response {
	const m = path.match(CHAT_STREAM)
	if (!m || !res.ok || !res.body) return res
	const sessionId = decodeURIComponent(m[1]!)
	const [client, watch] = res.body.tee()
	void (async () => {
		let runId = ''
		let buf = ''
		const reader = watch.pipeThrough(new TextDecoderStream()).getReader()
		try {
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				if (runId) continue
				buf += value
				const hit = buf.match(/"run_id"\s*:\s*"([^"]+)"/)
				if (hit) {
					runId = hit[1]!
					active.set(sessionId, { runId, startedAt: Date.now() })
					buf = ''
				} else if (buf.length > 64_000) buf = buf.slice(-1000)
			}
		} catch {
		} finally {
			if (runId && active.get(sessionId)?.runId === runId) active.delete(sessionId)
		}
	})()
	return new Response(client, { status: res.status, statusText: res.statusText, headers: res.headers })
}

export const runRoutes = new Elysia().get('/ui-api/runs', () =>
	Object.fromEntries([...active].map(([sessionId, r]) => [sessionId, r.runId])),
)
