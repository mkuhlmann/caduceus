import { getConnection, onConnectionChange, type Connection } from './config'
import { isChatStream } from './runs'

/**
 * Same-origin relay to the two public Hermes HTTP surfaces. It exists for three reasons:
 * keys stay server-side, browser CORS limits disappear (the gateway refuses PATCH and
 * custom headers cross-origin, the dashboard only allows localhost origins), and SSE
 * streams pass straight through without buffering.
 */
const HOP_BY_HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'host',
	'cookie',
	'origin',
	'referer',
	'content-length',
	'accept-encoding',
	'authorization',
	'x-hermes-session-token',
])

/**
 * Dashboard basic auth is a login form, not HTTP Basic: log in once, keep the session
 * cookies server-side, and take rotated cookies from every response.
 */
const jar = new Map<string, string>()
let loginInFlight: Promise<void> | null = null
onConnectionChange(() => {
	jar.clear()
	scrapedDashToken = null
})

function absorbCookies(res: Response) {
	for (const raw of res.headers.getSetCookie()) {
		const [pair, ...attrs] = raw.split(';')
		const eq = pair!.indexOf('=')
		if (eq < 1) continue
		const name = pair!.slice(0, eq).trim()
		const value = pair!.slice(eq + 1).trim()
		const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === ''
		if (expired) jar.delete(name)
		else jar.set(name, value)
	}
}

function cookieHeader() {
	return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function dashboardLogin(c: Connection) {
	loginInFlight ??= (async () => {
		jar.clear()
		const res = await fetch(c.dashboardUrl + '/auth/password-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				provider: 'basic',
				username: c.dashboardUsername,
				password: c.dashboardPassword,
				next: '',
			}),
			redirect: 'manual',
		})
		if (!res.ok) {
			const detail = await res.text().catch(() => '')
			throw new LoginError(res.status, detail)
		}
		absorbCookies(res)
	})().finally(() => (loginInFlight = null))
	return loginInFlight
}

class LoginError extends Error {
	constructor(
		public status: number,
		detail: string,
	) {
		super(
			status === 401
				? 'The dashboard rejected the username or password.'
				: status === 404
					? 'The dashboard has no basic-auth login enabled.'
					: status === 429
						? 'Too many dashboard login attempts. Wait a moment and retry.'
						: `Dashboard login failed (${status}): ${detail.slice(0, 200)}`,
		)
	}
}

let scrapedDashToken: { base: string; token: string } | null = null

/** Loopback dashboards embed an ephemeral token in index.html; pick it up when none is configured. */
async function scrapeDashboardToken(base: string, force = false): Promise<string> {
	if (!force && scrapedDashToken?.base === base) return scrapedDashToken.token
	try {
		const html = await (await fetch(base + '/', { redirect: 'manual' })).text()
		const m = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)
		if (m) {
			scrapedDashToken = { base, token: m[1]! }
			return m[1]!
		}
	} catch {}
	return ''
}

export async function relay(target: 'gw' | 'dash', path: string, req: Request): Promise<Response> {
	const c = getConnection()
	const base = target === 'gw' ? c.gatewayUrl : c.dashboardUrl
	if (!base) {
		return Response.json(
			{
				error: {
					message: `No ${target === 'gw' ? 'gateway API' : 'dashboard'} URL configured.`,
					code: 'not_configured',
				},
			},
			{ status: 503 },
		)
	}
	const search = new URL(req.url).search
	const upstream = base + path + search

	const send = async (retry: boolean): Promise<Response> => {
		const headers = new Headers()
		req.headers.forEach((v, k) => {
			if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v)
		})
		if (target === 'gw') {
			if (c.gatewayKey) headers.set('Authorization', `Bearer ${c.gatewayKey}`)
		} else {
			if (c.dashboardUsername && c.dashboardPassword) {
				if (retry || jar.size === 0) await dashboardLogin(c)
				headers.set('Cookie', cookieHeader())
			}
			const token = c.dashboardToken || (c.dashboardUsername ? '' : await scrapeDashboardToken(base, retry))
			if (token) {
				// Gated dashboards read the bearer; loopback dashboards prefer the session-token header.
				headers.set('Authorization', `Bearer ${token}`)
				headers.set('X-Hermes-Session-Token', token)
			}
		}
		const hasBody = !['GET', 'HEAD'].includes(req.method)
		return fetch(upstream, {
			method: req.method,
			headers,
			body: hasBody ? await req.clone().arrayBuffer() : undefined,
			redirect: 'manual',
			signal: target === 'gw' && isChatStream(path) ? undefined : req.signal,
		})
	}

	let res: Response
	try {
		res = await send(false)
		if (res.status === 401 && target === 'dash' && !c.dashboardToken) res = await send(true)
		if (target === 'dash') absorbCookies(res)
	} catch (e) {
		if ((e as Error).name === 'AbortError') return new Response(null, { status: 499 })
		if (e instanceof LoginError) {
			return Response.json({ error: { message: e.message, code: 'dashboard_login_failed' } }, { status: 502 })
		}
		return Response.json(
			{
				error: {
					message: `Could not reach ${upstream.replace(/\?.*/, '')}: ${(e as Error).message}`,
					code: 'upstream_unreachable',
				},
			},
			{ status: 502 },
		)
	}

	const out = new Headers()
	res.headers.forEach((v, k) => {
		const key = k.toLowerCase()
		if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key)) return
		if (key.startsWith('access-control-')) return
		out.set(k, v)
	})
	if ((out.get('content-type') ?? '').includes('text/event-stream')) {
		out.set('Cache-Control', 'no-cache')
		out.set('X-Accel-Buffering', 'no')
	}
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
}
