import { Elysia } from 'elysia'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getConnection, saveConnection, publicConnection, envLocked } from './config'
import { relay } from './relay'
import { authGuard, authRoutes } from './auth'
import { projectRoutes } from './projects'
import { runRoutes, trackChatStream } from './runs'
import { embedded } from './embedded'

const port = Number(process.env.PORT ?? 7811)
const host = process.env.HOST ?? '127.0.0.1'
const distDir = resolve(process.env.CADUCEUS_DIST ?? join(import.meta.dir, '..', 'dist'))

// The relay holds admin credentials for Hermes. On a network address it must be password-protected.
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host)
if (!loopback && !process.env.CADUCEUS_PASSWORD && process.env.CADUCEUS_ALLOW_NO_PASSWORD !== '1') {
	console.error(
		`Refusing to listen on ${host} without CADUCEUS_PASSWORD: anyone who can reach it could control Hermes.\n` +
			'Set CADUCEUS_PASSWORD, or CADUCEUS_ALLOW_NO_PASSWORD=1 if a proxy in front of it handles sign-in.',
	)
	process.exit(1)
}

const app = new Elysia()
	.use(authRoutes)
	.onBeforeHandle({ as: 'global' }, authGuard)
	.use(projectRoutes)
	.use(runRoutes)
	.get('/ui-api/connection', () => publicConnection())
	.put('/ui-api/connection', async ({ body, set }) => {
		if (envLocked) {
			set.status = 409
			return { error: 'Connection is set by environment variables on the server.' }
		}
		saveConnection(body as any)
		return publicConnection()
	})
	.post('/ui-api/connection/test', async () => {
		const c = getConnection()
		const probe = async (target: 'gw' | 'dash', path: string) => {
			try {
				const res = await relay(target, path, new Request('http://x' + path))
				const text = await res.text()
				return { ok: res.ok, status: res.status, detail: res.ok ? undefined : text.slice(0, 300) }
			} catch (e) {
				return { ok: false, status: 0, detail: String((e as Error).message ?? e) }
			}
		}
		return {
			gateway: c.gatewayUrl ? await probe('gw', '/v1/capabilities') : null,
			dashboard: c.dashboardUrl ? await probe('dash', '/api/status') : null,
		}
	})

// Method-specific routes: Elysia ranks `.get('/*')` (static files) above `.all(...)`.
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
	app.route(method, '/ui-api/gw/*', async ({ request, params }) =>
		trackChatStream('/' + params['*'], await relay('gw', '/' + params['*'], request)),
	)
	app.route(method, '/ui-api/dash/*', ({ request, params }) => relay('dash', '/' + params['*'], request))
}
app.get('/*', ({ params }) => serveStatic(params['*']))

function serveStatic(path: string) {
	if (!embedded.size && !existsSync(distDir))
		return new Response('Frontend not built. Run `bun run build`.', { status: 404 })
	const file = embedded.size ? embedded.get(path) : diskFile(path)
	if (file) {
		const immutable = path.startsWith('assets/')
		return new Response(Bun.file(file), {
			headers: immutable ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {},
		})
	}
	const index = embedded.get('index.html') ?? join(distDir, 'index.html')
	return new Response(Bun.file(index), { headers: { 'Cache-Control': 'no-cache' } })
}

function diskFile(path: string) {
	const safe = resolve(distDir, '.' + '/' + decodeURIComponent(path || ''))
	if (safe.startsWith(distDir) && path && existsSync(safe) && Bun.file(safe).size > 0) return safe
}

app.listen({ port, hostname: host, idleTimeout: 0, reusePort: false })
console.log(`Caduceus listening on http://${host}:${port}`)

export type App = typeof app
