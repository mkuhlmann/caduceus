export type SseFrame = { event?: string; id?: string; data: string }

/** Parse a fetch() body as Server-Sent Events. Works with POST + auth headers, unlike EventSource. */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<SseFrame> {
	if (!res.body) return
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
	let buf = ''
	const onAbort = () => reader.cancel().catch(() => {})
	signal?.addEventListener('abort', onAbort)
	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) break
			buf += value
			let idx: number
			while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
				const raw = buf.slice(0, idx)
				buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
				const frame: SseFrame = { data: '' }
				const data: string[] = []
				for (const line of raw.split(/\r?\n/)) {
					if (!line || line.startsWith(':')) continue
					const colon = line.indexOf(':')
					const field = colon === -1 ? line : line.slice(0, colon)
					const val = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
					if (field === 'data') data.push(val)
					else if (field === 'event') frame.event = val
					else if (field === 'id') frame.id = val
				}
				if (!data.length) continue
				frame.data = data.join('\n')
				yield frame
			}
		}
	} finally {
		signal?.removeEventListener('abort', onAbort)
	}
}
