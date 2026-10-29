/**
 * All Hermes traffic goes through the Caduceus relay on the same origin:
 *   /ui-api/gw/*   → Hermes gateway API server (auth injected by the relay)
 *   /ui-api/dash/* → Hermes dashboard (auth injected by the relay)
 * The relay keeps keys out of the browser and sidesteps CORS (PATCH, custom headers).
 */
export const GW = 'ui-api/gw'
export const DASH = 'ui-api/dash'

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
	) {
		super(message)
	}
}

function base() {
	// Relative to the page so the build works under a sub-path or inside a webview.
	return new URL('./', location.href).toString().replace(/#.*$/, '')
}

export function url(path: string) {
	return base() + path.replace(/^\//, '')
}

export async function request<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
	const headers = new Headers(init.headers)
	let body = init.body
	if (init.json !== undefined) {
		headers.set('Content-Type', 'application/json')
		body = JSON.stringify(init.json)
	}
	const res = await fetch(url(path), { ...init, headers, body })
	if (!res.ok) throw await toError(res)
	if (res.status === 204) return undefined as T
	const type = res.headers.get('content-type') ?? ''
	return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

export async function toError(res: Response): Promise<ApiError> {
	let message = `${res.status} ${res.statusText}`
	let code: string | undefined
	try {
		const data = await res.json()
		const err = data?.error ?? data
		message = (typeof err === 'string' ? err : (err?.message ?? data?.detail ?? message)) as string
		if (typeof message !== 'string') message = JSON.stringify(message)
		code = err?.code
	} catch {}
	return new ApiError(message, res.status, code)
}

export const get = <T = any>(p: string) => request<T>(p)
export const post = <T = any>(p: string, json?: unknown) => request<T>(p, { method: 'POST', json: json ?? {} })
export const put = <T = any>(p: string, json?: unknown) => request<T>(p, { method: 'PUT', json })
export const patch = <T = any>(p: string, json?: unknown) => request<T>(p, { method: 'PATCH', json })
export const del = <T = any>(p: string) => request<T>(p, { method: 'DELETE' })

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
	const s = new URLSearchParams()
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
	const str = s.toString()
	return str ? `?${str}` : ''
}
