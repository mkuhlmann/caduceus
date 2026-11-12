import { Elysia } from 'elysia'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { relay } from './relay'
import { rpc, RpcError, viewerSupport } from './hermes-socket'
import { faceColor } from './face-color'

/**
 * Hermes bots are profiles. The dashboard creates and deletes them; the multiplexed gateway serves each one under
 * `/p/<profile>/` with that profile's own API_SERVER_KEY, which Caduceus mints when it connects a bot and keeps
 * here, server-side.
 *
 * Everything a bot looks like lives in Hermes, in the profile's `ui_meta` (written over the Hermes socket), so
 * Caduceus and Hermes Desktop show the same bot:
 * - `ui_meta["hermes-bots"]`: Desktop's own record. Its presence marks the install as Bot Mode managed, which is
 *   what gives canonical Bot Chats the `message_agent` tool. Title, description, hidden, pinned and section live
 *   here with Desktop's meaning.
 * - `ui_meta["caduceus"]`: Caduceus's face (body and colour), which Desktop ignores.
 * - The picture is the profile's `avatar` asset.
 */
export type BotLook = { shape: string; color: string }

const BOTS_KEY = 'hermes-bots'
const OWN_KEY = 'caduceus'

type LocalRecord = {
	key?: string
	updatedAt: number
	// Before the metadata moved to Hermes it was kept here; migrated once, then dropped.
	title?: string
	look?: BotLook & { eyes?: string }
	image?: string
}

type HermesProfile = {
	name: string
	is_default?: boolean
	ui_meta?: Record<string, any>
	ui_meta_revisions?: Record<string, number>
	has_avatar?: boolean
}

const file = join(process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data'), 'bots.json')

function load(): Record<string, LocalRecord> {
	if (!existsSync(file)) return {}
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return {}
	}
}

let local = load()

function persist() {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify(local, null, 2), { mode: 0o600 })
}

/** The gateway key Caduceus set for a bot, for the relay. */
export function botKey(name: string): string | undefined {
	return local[name]?.key
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_IMAGE = 2_700_000
const KEY_VAR = 'API_SERVER_KEY'

class BotError extends Error {
	constructor(
		public status: number,
		message: string,
		public code?: string,
	) {
		super(message)
	}
}

/** A call to the Hermes dashboard through the relay, which holds its credentials. */
async function dash<T = any>(method: string, path: string, body?: unknown): Promise<T> {
	// The relay forwards the request's query string and method; the path is passed separately.
	const req = new Request('http://relay' + path, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const res = await relay('dash', path.replace(/\?.*/, ''), req)
	const text = await res.text()
	let data: any = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {}
	if (!res.ok) {
		const err = data?.error ?? data?.detail ?? data
		const message = typeof err === 'string' ? err : (err?.message ?? `Hermes answered ${res.status}`)
		throw new BotError(res.status >= 500 ? 502 : res.status, message, err?.code)
	}
	return data as T
}

async function profiles(): Promise<HermesProfile[]> {
	const r = await rpc<{ profiles: HermesProfile[] }>('profiles.list', { include_sessions: false })
	return r.profiles ?? []
}

/** Drop keys set to null or undefined, the way a patch says "remove this". */
function prune(o: Record<string, any>) {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))
}

/**
 * Merge `bots` into the profile's `hermes-bots` record and `own` into Caduceus's, with Hermes' per-key revision
 * check so a concurrent edit from Desktop is merged rather than overwritten.
 */
async function patchMeta(name: string, patch: { bots?: Record<string, any>; own?: Record<string, any> }) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const p = (await profiles()).find((x) => x.name === name)
		if (!p) throw new BotError(404, `Hermes has no bot named ${name}.`)
		const ui_meta: Record<string, any> = {}
		const expected: Record<string, number> = {}
		if (patch.bots) {
			ui_meta[BOTS_KEY] = prune({ ...(p.ui_meta?.[BOTS_KEY] ?? {}), ...patch.bots })
			expected[BOTS_KEY] = p.ui_meta_revisions?.[BOTS_KEY] ?? 0
		}
		if (patch.own) {
			ui_meta[OWN_KEY] = prune({ ...(p.ui_meta?.[OWN_KEY] ?? {}), ...patch.own })
			expected[OWN_KEY] = p.ui_meta_revisions?.[OWN_KEY] ?? 0
		}
		const r = await rpc<{ applied?: Record<string, any> }>('profiles.configure', {
			name,
			ui_meta,
			ui_meta_expected_revisions: expected,
		})
		if (r.applied?.ui_meta) return
		if (!r.applied?.ui_meta_conflicts) throw new BotError(502, 'Hermes did not save the bot’s settings.')
	}
	throw new BotError(409, 'Someone else is editing this bot right now. Try again.')
}

async function setPicture(name: string, image: string | null) {
	if (image === null) {
		await rpc('profiles.set_asset', { name, asset: 'avatar', clear: true })
		return
	}
	if (!/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > MAX_IMAGE)
		throw new BotError(400, 'The picture must be a PNG, JPEG or WebP image under 2 MB.')
	await rpc('profiles.set_asset', { name, asset: 'avatar', data: image })
}

function cleanLook(v: any): BotLook | null {
	if (!v || typeof v !== 'object') return null
	const s = (x: unknown) => String(x ?? '').slice(0, 32)
	return { shape: s(v.shape), color: s(v.color) }
}

/** Whether the bot has a drawn face from Hermes and no face chosen in Caduceus, so its colour is worth reading. */
const wantsFaceColor = (p: HermesProfile) =>
	!!p.has_avatar && p.ui_meta?.[BOTS_KEY]?.imageKind !== 'photo' && !p.ui_meta?.[OWN_KEY]?.look

const FACE_TTL = 10 * 60_000
const faceColors = new Map<string, { color: string | null; at: number }>()

/** The main colour of each such bot's drawn face, read once and kept for a while. */
async function readFaceColors(list: HermesProfile[]) {
	await Promise.all(
		list.filter(wantsFaceColor).map(async (p) => {
			const hit = faceColors.get(p.name)
			if (hit && Date.now() - hit.at < FACE_TTL) return
			try {
				const r = await rpc<{ found?: boolean; data?: string }>('profiles.get_asset', { name: p.name, asset: 'avatar' })
				const color = r.found && r.data ? faceColor(Buffer.from(r.data.replace(/^data:[^,]*,/, ''), 'base64')) : null
				faceColors.set(p.name, { color, at: Date.now() })
			} catch {
				// No colour this time; the face falls back to the generated one.
			}
		}),
	)
}

function publicBot(p: HermesProfile) {
	const meta = p.ui_meta?.[BOTS_KEY] ?? {}
	const own = p.ui_meta?.[OWN_KEY] ?? {}
	const isDefault = !!p.is_default || p.name === 'default'
	// A profile can carry an avatar asset that is only a drawn face (Hermes Desktop's, or one made for it), often
	// with no record of what it is. Only a picture marked as a photo replaces Caduceus's face; Caduceus marks every
	// picture it saves.
	const photo = p.has_avatar && meta.imageKind === 'photo'
	const rev = (p.ui_meta_revisions?.[BOTS_KEY] ?? 0) + '.' + (p.ui_meta_revisions?.[OWN_KEY] ?? 0)
	return {
		name: p.name,
		title: String(meta.title ?? ''),
		look: cleanLook(own.look),
		image: photo ? `ui-api/bots/${encodeURIComponent(p.name)}/avatar?v=${rev}` : null,
		// Hermes' drawn face's colour, for a bot with no face chosen here: Caduceus draws its own in the nearest colour.
		faceColor: wantsFaceColor(p) ? (faceColors.get(p.name)?.color ?? null) : null,
		hidden: !!meta.hidden,
		pinned: !!meta.pinned,
		sectionId: meta.sectionId ?? null,
		sectionName: meta.sectionName ?? null,
		connected: isDefault || !!local[p.name]?.key,
		managed: !!p.ui_meta?.[BOTS_KEY],
	}
}

/**
 * Once per bot: mark it as a Bot Mode bot (an empty `hermes-bots` record is enough) and move whatever older
 * Caduceus versions kept here into Hermes.
 */
const settled = new Set<string>()
async function settle(list: HermesProfile[]) {
	for (const p of list) {
		if (settled.has(p.name)) continue
		settled.add(p.name)
		const old = local[p.name]
		const bots: Record<string, any> = {}
		const own: Record<string, any> = {}
		if (old?.title && !p.ui_meta?.[BOTS_KEY]?.title) bots.title = old.title
		if (old?.look && !p.ui_meta?.[OWN_KEY]?.look) own.look = cleanLook(old.look)
		const needsMarker = !p.ui_meta?.[BOTS_KEY]
		try {
			if (needsMarker || Object.keys(bots).length || Object.keys(own).length)
				await patchMeta(p.name, {
					bots: needsMarker || Object.keys(bots).length ? bots : undefined,
					own: Object.keys(own).length ? own : undefined,
				})
			if (old?.image && !p.has_avatar) {
				await setPicture(p.name, old.image)
				await patchMeta(p.name, { bots: { imageKind: 'photo', custom: true } })
			}
			if (old && (old.title || old.look || old.image)) {
				delete old.title
				delete old.look
				delete old.image
				persist()
			}
		} catch {
			settled.delete(p.name)
		}
	}
}

/** Give the bot a fresh gateway key in its own `.env` and remember it. */
async function connect(name: string) {
	const key = randomBytes(24).toString('hex')
	await dash('PUT', `/api/env?profile=${encodeURIComponent(name)}`, { key: KEY_VAR, value: key, profile: name })
	;(local[name] ??= { updatedAt: Date.now() }).key = key
	local[name]!.updatedAt = Date.now()
	persist()
}

async function one(name: string) {
	const p = (await profiles()).find((x) => x.name === name)
	if (!p) throw new BotError(404, `Hermes has no bot named ${name}.`)
	await readFaceColors([p])
	return publicBot(p)
}

/** Apply an edit from the browser: Desktop's fields, Caduceus's face, and the picture. */
async function applyEdit(name: string, body: any) {
	const bots: Record<string, any> = {}
	const own: Record<string, any> = {}
	if ('title' in body)
		bots.title =
			String(body.title ?? '')
				.trim()
				.slice(0, 80) || null
	if ('description' in body) bots.description = String(body.description ?? '').trim() || null
	if ('hidden' in body) bots.hidden = body.hidden ? true : null
	if ('pinned' in body) bots.pinned = body.pinned ? true : null
	if ('sectionId' in body) {
		bots.sectionId = body.sectionId ? String(body.sectionId).slice(0, 64) : null
		bots.sectionName = body.sectionId ? String(body.sectionName ?? '').slice(0, 80) || null : null
	}
	if ('look' in body) {
		own.look = cleanLook(body.look)
		bots.custom = true
	}
	if ('image' in body) {
		const image = body.image === '' ? null : body.image
		await setPicture(name, image)
		faceColors.delete(name)
		bots.imageKind = image ? 'photo' : null
		bots.custom = true
	}
	await patchMeta(name, {
		bots: Object.keys(bots).length ? bots : undefined,
		own: Object.keys(own).length ? own : undefined,
	})
}

function fail(set: { status?: number | string }, e: unknown) {
	const err = e as BotError & RpcError
	set.status = typeof err.status === 'number' ? err.status : err instanceof RpcError ? 502 : 500
	return { error: { message: err.message, code: err.code } }
}

type Attached = { session_id?: string; subscription_id?: string; revision?: number; execution_generation?: number }

/**
 * Compact on a socket the gateway serves (the Webapp's): there the chat is the gateway's own, and compacting is a
 * revision-fenced `session.mutate`, as Hermes Desktop sends it. The attach only reads; it is let go of afterwards.
 */
async function compactOnAuthority(name: string, sessionId: string) {
	const scope = name === 'default' ? {} : { profile: name }
	const a = await rpc<Attached>('session.resume', { ...scope, session_id: sessionId, omit_messages: true })
	try {
		if (!a.session_id || typeof a.revision !== 'number')
			throw new BotError(502, 'Hermes did not open the chat for compacting.')
		const r = await rpc<Record<string, any>>(
			'session.mutate',
			{
				...scope,
				session_id: a.session_id,
				request_id: randomBytes(16).toString('hex'),
				expected_revision: a.revision,
				...(typeof a.execution_generation === 'number' ? { expected_generation: a.execution_generation } : {}),
				operation: 'compress',
				payload: {},
			},
			300_000,
		)
		const status = typeof r.status === 'string' ? r.status : null
		const removed = typeof r.removed === 'number' ? r.removed : null
		return {
			ok: true,
			compressed: status !== 'aborted' && status !== 'noop' && removed !== 0,
			status,
			removed,
			message: typeof r.message === 'string' ? r.message : null,
		}
	} finally {
		if (a.subscription_id)
			rpc('session.detach', {
				...scope,
				session_id: a.session_id ?? sessionId,
				subscription_id: a.subscription_id,
			}).catch(() => {})
	}
}

export const botRoutes = new Elysia({ prefix: '/ui-api/bots' })
	.get('/', async ({ set }) => {
		try {
			const list = await profiles()
			void settle(list)
			await readFaceColors(list)
			return list.map(publicBot)
		} catch (e) {
			return fail(set, e)
		}
	})
	.get('/:name/avatar', async ({ params, set }) => {
		try {
			const r = await rpc<{ found?: boolean; mime?: string; data?: string }>('profiles.get_asset', {
				name: params.name,
				asset: 'avatar',
			})
			if (!r.found || !r.data) return ((set.status = 404), { error: { message: 'No picture.' } })
			const bytes = Buffer.from(r.data.replace(/^data:[^,]*,/, ''), 'base64')
			return new Response(bytes, {
				headers: { 'Content-Type': r.mime ?? 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' },
			})
		} catch (e) {
			return fail(set, e)
		}
	})
	.post('/', async ({ body, set }) => {
		const b = (body ?? {}) as any
		const name = String(b.name ?? '')
			.trim()
			.toLowerCase()
		if (!NAME.test(name) || name === 'default')
			return fail(
				set,
				new BotError(400, 'Use lowercase letters, digits, - and _ for the name, starting with a letter or digit.'),
			)
		try {
			const clone = String(b.cloneFrom ?? '')
			await dash('POST', '/api/profiles', {
				name,
				description: String(b.description ?? '') || null,
				soul: String(b.soul ?? '') || null,
				...(clone === 'default' ? { clone_from_default: true } : clone ? { clone_from: clone } : {}),
				no_skills: !clone && !!b.noSkills,
				...(b.provider && b.model ? { provider: String(b.provider), model: String(b.model) } : {}),
			})
			await connect(name)
			settled.add(name)
			await patchMeta(name, {
				bots: prune({
					title: String(b.title ?? '').trim() || null,
					description: String(b.description ?? '').trim() || null,
					created: Date.now(),
					custom: true,
				}),
				own: { look: cleanLook(b.look) },
			})
			if (b.image) {
				await setPicture(name, b.image)
				await patchMeta(name, { bots: { imageKind: 'photo' } })
			}
			return await one(name)
		} catch (e) {
			return fail(set, e)
		}
	})
	.post('/:name/duplicate', async ({ params, body, set }) => {
		const name = String((body as any)?.name ?? '')
			.trim()
			.toLowerCase()
		if (!NAME.test(name) || name === 'default')
			return fail(
				set,
				new BotError(400, 'Use lowercase letters, digits, - and _ for the name, starting with a letter or digit.'),
			)
		try {
			// A full clone: config, skills, SOUL.md, memory. The look comes with ui_meta; the key is replaced below.
			await dash('POST', '/api/profiles', {
				name,
				...(params.name === 'default' ? { clone_from_default: true } : { clone_from: params.name }),
				clone_all: true,
			})
			await connect(name)
			settled.add(name)
			const source = (await profiles()).find((x) => x.name === params.name)
			const meta = { ...(source?.ui_meta?.[BOTS_KEY] ?? {}) }
			const title = String((body as any)?.title ?? '').trim()
			await patchMeta(name, {
				bots: { ...meta, title: title || null, created: Date.now(), pinned: null },
				own: source?.ui_meta?.[OWN_KEY] ?? {},
			})
			if (source?.has_avatar) {
				const pic = await rpc<{ found?: boolean; data?: string }>('profiles.get_asset', {
					name: params.name,
					asset: 'avatar',
				})
				if (pic.found && pic.data) await setPicture(name, pic.data)
			}
			return await one(name)
		} catch (e) {
			return fail(set, e)
		}
	})
	// Which skills, toolsets and MCP servers the bot may use (replace semantics, as Hermes Desktop's editor).
	.put('/:name/capabilities', async ({ params, body, set }) => {
		const b = (body ?? {}) as Record<string, unknown>
		const lists = Object.fromEntries(
			(['disabled_skills', 'enabled_toolsets', 'enabled_mcp_servers'] as const)
				.filter((k) => Array.isArray(b[k]))
				.map((k) => [k, (b[k] as unknown[]).map(String)]),
		)
		if (!Object.keys(lists).length) return fail(set, new BotError(400, 'Nothing to save.'))
		try {
			const r = await rpc<{ ok?: boolean; applied?: Record<string, boolean> }>('profiles.configure', {
				name: params.name,
				...lists,
			})
			if (r.ok === false) throw new BotError(502, 'Hermes did not save every change. Reload and check the lists.')
			return { ok: true, applied: r.applied }
		} catch (e) {
			return fail(set, e)
		}
	})
	// `/new` in a Bot Chat compacts it instead (it is one forever-conversation): resume the stored chat on the Hermes
	// socket, compress it there, and let go of it again.
	.post('/:name/compact', async ({ params, body, set }) => {
		const sessionId = String((body as any)?.sessionId ?? '')
		if (!sessionId) return fail(set, new BotError(400, 'Which chat should be compacted?'))
		try {
			if (await viewerSupport()) return await compactOnAuthority(params.name, sessionId)
		} catch (e) {
			return fail(set, e)
		}
		let runtime = ''
		try {
			const r = await rpc<{ session_id?: string }>('session.resume', {
				profile: params.name,
				session_id: sessionId,
				omit_messages: true,
				inline_images: false,
				close_on_disconnect: true,
			})
			runtime = r.session_id ?? ''
			if (!runtime) throw new BotError(502, 'Hermes did not open the chat for compacting.')
			const c = await rpc<{ compressed?: boolean; removed?: number; message?: string; status?: string }>(
				'session.compress',
				{ session_id: runtime },
				300_000,
			)
			const compressed = c.compressed !== false && c.status !== 'aborted' && !!(c.removed ?? 1)
			return { ok: true, compressed, status: c.status ?? null, removed: c.removed ?? null, message: c.message ?? null }
		} catch (e) {
			return fail(set, e)
		} finally {
			if (runtime) rpc('session.close', { session_id: runtime }).catch(() => {})
		}
	})
	.patch('/:name', async ({ params, body, set }) => {
		try {
			await applyEdit(params.name, body ?? {})
			return await one(params.name)
		} catch (e) {
			return fail(set, e)
		}
	})
	.post('/:name/connect', async ({ params, body, set }) => {
		if (params.name === 'default') return fail(set, new BotError(400, 'Hermes itself uses the connection key.'))
		try {
			// A key someone else set (the desktop app, a peer) is replaced only when asked to.
			if (!(body as any)?.replace) {
				const env = await dash<Record<string, { is_set?: boolean }>>(
					'GET',
					`/api/env?profile=${encodeURIComponent(params.name)}`,
				)
				if (env?.[KEY_VAR]?.is_set)
					return fail(set, new BotError(409, 'This bot already has a gateway key.', 'key_exists'))
			}
			await connect(params.name)
			return await one(params.name)
		} catch (e) {
			return fail(set, e)
		}
	})
	.delete('/:name', async ({ params, set }) => {
		if (params.name === 'default') return fail(set, new BotError(400, 'Hermes itself cannot be deleted.'))
		try {
			await dash('DELETE', `/api/profiles/${encodeURIComponent(params.name)}`)
		} catch (e) {
			if ((e as BotError).status !== 404) return fail(set, e)
		}
		delete local[params.name]
		settled.delete(params.name)
		persist()
		return { ok: true }
	})
