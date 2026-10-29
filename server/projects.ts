import { Elysia } from 'elysia'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Projects group chats and carry standing instructions that are sent as the system
 * prompt when a chat starts inside the project. Hermes' own folder projects need a
 * working directory on the agent host, which the public chat API does not expose, so
 * these live with the UI instead.
 */
export type Project = {
	id: string
	name: string
	description: string
	instructions: string
	color: string
	sessionIds: string[]
	createdAt: number
	updatedAt: number
}

const file = join(process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data'), 'projects.json')

function load(): Project[] {
	if (!existsSync(file)) return []
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return []
	}
}

let projects = load()

function persist() {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify(projects, null, 2))
}

const EDITABLE = ['name', 'description', 'instructions', 'color', 'sessionIds'] as const

function clean(body: any): Partial<Project> {
	const out: any = {}
	for (const k of EDITABLE) {
		if (!(k in (body ?? {}))) continue
		out[k] = k === 'sessionIds' ? [...new Set((body[k] as unknown[]).map(String))] : String(body[k] ?? '')
	}
	return out
}

export const projectRoutes = new Elysia({ prefix: '/ui-api/projects' })
	.get('/', () => projects)
	.post('/', ({ body }) => {
		const now = Date.now()
		const p: Project = {
			id: randomUUID(),
			name: 'Untitled project',
			description: '',
			instructions: '',
			color: 'lapis',
			sessionIds: [],
			createdAt: now,
			updatedAt: now,
			...clean(body),
		}
		projects.push(p)
		persist()
		return p
	})
	.patch('/:id', ({ params, body, set }) => {
		const p = projects.find((x) => x.id === params.id)
		if (!p) return ((set.status = 404), { error: 'Project not found' })
		Object.assign(p, clean(body), { updatedAt: Date.now() })
		persist()
		return p
	})
	.post('/:id/sessions', ({ params, body, set }) => {
		const sessionId = String((body as any)?.sessionId ?? '')
		// A chat belongs to at most one project.
		for (const p of projects) p.sessionIds = p.sessionIds.filter((s) => s !== sessionId)
		const p = projects.find((x) => x.id === params.id)
		if (params.id !== 'none' && !p) return ((set.status = 404), { error: 'Project not found' })
		if (p && sessionId) p.sessionIds.unshift(sessionId)
		persist()
		return { ok: true }
	})
	.delete('/:id', ({ params }) => {
		projects = projects.filter((x) => x.id !== params.id)
		persist()
		return { ok: true }
	})
