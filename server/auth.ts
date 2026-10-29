import { Elysia } from 'elysia'
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

/**
 * Optional gate for hosting Caduceus on a network. Set CADUCEUS_PASSWORD and every
 * /ui-api request needs a signed cookie. Desktop builds bind to 127.0.0.1 and skip it.
 */
const password = process.env.CADUCEUS_PASSWORD ?? ''
const secret = process.env.CADUCEUS_SECRET ?? randomBytes(32).toString('hex')
const COOKIE = 'caduceus_session'
const MAX_AGE = 60 * 60 * 24 * 30

function sign(value: string) {
	return createHmac('sha256', secret).update(value).digest('base64url')
}

function issue() {
	const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE)
	return `${exp}.${sign(exp)}`
}

function valid(token: string | undefined) {
	if (!token) return false
	const [exp, sig] = token.split('.')
	if (!exp || !sig) return false
	const expected = Buffer.from(sign(exp))
	const got = Buffer.from(sig)
	return expected.length === got.length && timingSafeEqual(expected, got) && Number(exp) > Date.now() / 1000
}

function readCookie(req: Request) {
	const raw = req.headers.get('cookie') ?? ''
	return raw
		.split(/;\s*/)
		.find((c) => c.startsWith(COOKIE + '='))
		?.slice(COOKIE.length + 1)
}

export const authRoutes = new Elysia()
	.get('/ui-api/auth', ({ request }) => ({
		required: !!password,
		authenticated: !password || valid(readCookie(request)),
	}))
	.post('/ui-api/auth/login', ({ body, set, request }) => {
		const given = String((body as any)?.password ?? '')
		const a = Buffer.from(sign(given))
		const b = Buffer.from(sign(password))
		if (!password || !timingSafeEqual(a, b)) {
			set.status = 401
			return { error: 'That password is not correct.' }
		}
		const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
		set.headers['set-cookie'] = `${COOKIE}=${issue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure}`
		return { ok: true }
	})
	.post('/ui-api/auth/logout', ({ set }) => {
		set.headers['set-cookie'] = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
		return { ok: true }
	})

export function authGuard({ request, set }: { request: Request; set: any }) {
	if (!password) return
	const path = new URL(request.url).pathname
	if (!path.startsWith('/ui-api/') || path.startsWith('/ui-api/auth')) return
	if (!valid(readCookie(request))) {
		set.status = 401
		return { error: { message: 'Sign in to Caduceus first.', code: 'ui_auth_required' } }
	}
}
