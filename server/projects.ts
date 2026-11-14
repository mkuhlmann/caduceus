import { Elysia } from 'elysia'
import { Type, type Static } from '@sinclair/typebox'
import { randomUUID } from 'node:crypto'
import { broadcast } from './hermes-socket'
import { saveState, state, type Project } from './store'

/**
 * Projects group chats and carry standing instructions that are sent as the system
 * prompt when a chat starts inside the project. Hermes' own folder projects need a
 * working directory on the agent host, which the public chat API does not expose, so
 * these live with the UI instead.
 */
export type { Project }

/** What a person may set on a project. */
const EditSchema = Type.Partial(
	Type.Object({
		name: Type.String(),
		description: Type.String(),
		instructions: Type.String(),
		color: Type.String(),
		sessionIds: Type.Array(Type.String()),
	}),
)
type Edit = Static<typeof EditSchema>

/** Projects are kept in `state.json`. */
function persist() {
	saveState()
	// Other devices take the change at once.
	broadcast('caduceus.projects')
}

/** A chat is listed once. */
const clean = (e: Edit): Edit => (e.sessionIds ? { ...e, sessionIds: [...new Set(e.sessionIds)] } : e)

export const projectRoutes = new Elysia({ prefix: '/ui-api/projects' })
	.get('/', () => state.projects)
	.post(
		'/',
		({ body }) => {
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
				...clean(body ?? {}),
			}
			state.projects.push(p)
			persist()
			return p
		},
		{ body: Type.Optional(EditSchema) },
	)
	.patch(
		'/:id',
		({ params, body, set }) => {
			const p = state.projects.find((x) => x.id === params.id)
			if (!p) return ((set.status = 404), { error: 'Project not found' })
			Object.assign(p, clean(body), { updatedAt: Date.now() })
			persist()
			return p
		},
		{ body: EditSchema },
	)
	.post(
		'/:id/sessions',
		({ params, body, set }) => {
			const { sessionId } = body
			const p = state.projects.find((x) => x.id === params.id)
			if (params.id !== 'none' && !p) return ((set.status = 404), { error: 'Project not found' })
			// A chat belongs to at most one project.
			for (const q of state.projects) q.sessionIds = q.sessionIds.filter((s) => s !== sessionId)
			if (p && sessionId) p.sessionIds.unshift(sessionId)
			persist()
			return { ok: true }
		},
		{ body: Type.Object({ sessionId: Type.String() }) },
	)
	.delete('/:id', ({ params }) => {
		state.projects = state.projects.filter((x) => x.id !== params.id)
		persist()
		return { ok: true }
	})
