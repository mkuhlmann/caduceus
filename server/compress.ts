import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

/**
 * Hermes answers uncompressed and without validators. For JSON the relay adds both:
 *
 * - An ETag from a hash of the body. The browser keeps the last answer and sends its tag back on the next
 *   request; an unchanged one (a chat that did not move since it was last opened) costs a bodyless 304.
 * - Brotli or gzip, so a 500 KB transcript crosses the network as ~110 KB.
 *
 * Hermes is still asked every time: the relay never answers from a copy of its own, so nothing is stale.
 */

// Below this, compressing costs more than it saves.
const MIN_BYTES = 1024
// Quality 4 keeps a 500 KB transcript at ~6 ms while still beating gzip on size.
const BROTLI = { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }

export type Encoding = 'br' | 'gzip' | null

export function pickEncoding(accept: string | null): Encoding {
	if (!accept) return null
	const offered = accept
		.toLowerCase()
		.split(',')
		.map((p) => p.trim())
		.filter((p) => !/;\s*q=0(\.0*)?\s*$/.test(p))
		.map((p) => p.split(';')[0]!.trim())
	if (offered.includes('br')) return 'br'
	if (offered.includes('gzip') || offered.includes('*')) return 'gzip'
	return null
}

type Bytes = Uint8Array<ArrayBuffer>

export function compress(body: Uint8Array, encoding: Encoding): Bytes | null {
	if (!encoding || body.length < MIN_BYTES) return null
	return (encoding === 'br' ? brotliCompressSync(body, BROTLI) : gzipSync(body)) as Bytes
}

function etagOf(body: Uint8Array) {
	return `W/"${Bun.hash(body).toString(36)}-${body.length.toString(36)}"`
}

function matches(ifNoneMatch: string | null, tag: string) {
	if (!ifNoneMatch) return false
	return ifNoneMatch.split(',').some((t) => t.trim() === tag || t.trim() === '*')
}

const isJson = (type: string | null) => !!type && /\bjson\b/i.test(type)

/**
 * Tag and compress a successful JSON answer to a GET. Anything else (streams, errors, writes) passes through.
 * `headers` are the ones already chosen for the browser; they are completed here.
 */
export async function finishJson(req: Request, res: Response, headers: Headers): Promise<Response> {
	if (req.method !== 'GET' || res.status !== 200 || !res.body || !isJson(headers.get('content-type'))) {
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
	}
	const body = new Uint8Array(await res.arrayBuffer())
	const tag = etagOf(body)
	headers.set('ETag', tag)
	// Kept by the browser but checked with the relay every time, and never by a shared cache.
	headers.set('Cache-Control', 'private, no-cache')
	headers.append('Vary', 'Accept-Encoding')
	if (matches(req.headers.get('if-none-match'), tag)) return new Response(null, { status: 304, headers })
	const encoding = pickEncoding(req.headers.get('accept-encoding'))
	const packed = compress(body, encoding)
	if (packed) headers.set('Content-Encoding', encoding!)
	return new Response(packed ?? body, { status: 200, headers })
}

// Built files are compressed once per version and kept: the bundle is the same for every visitor.
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt|map)$/i
const packedFiles = new Map<string, Bytes | null>()

/** A static file, compressed when the browser accepts it and the type is worth it. */
export async function fileResponse(file: string, req: Request, headers: Record<string, string>): Promise<Response> {
	const blob = Bun.file(file)
	const encoding = COMPRESSIBLE.test(file) ? pickEncoding(req.headers.get('accept-encoding')) : null
	if (!encoding) return new Response(blob, { headers })
	const key = `${file}|${blob.lastModified}|${encoding}`
	let packed = packedFiles.get(key)
	if (packed === undefined) {
		packed = compress(new Uint8Array(await blob.arrayBuffer()), encoding)
		packedFiles.set(key, packed)
	}
	if (!packed) return new Response(blob, { headers })
	return new Response(packed, {
		headers: { ...headers, 'Content-Type': blob.type, 'Content-Encoding': encoding, Vary: 'Accept-Encoding' },
	})
}
