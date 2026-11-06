import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, patch, del } from '@/lib/http'

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

// No gold: it is reserved for the agent's live activity.
export const PROJECT_COLORS: Record<string, string> = {
	lapis: 'var(--focus)',
	verdigris: 'var(--verdigris)',
	rose: 'var(--rose)',
	ink: 'var(--ink-2)',
}

export const useProjects = defineStore('projects', () => {
	const items = ref<Project[]>([])
	const loaded = ref(false)
	/** True while a reload runs over projects that are already shown. */
	const refreshing = ref(false)
	let inflight: Promise<void> | null = null

	/** Loads the projects. Calls while a load runs share it; once loaded, it refreshes in the background. */
	function load() {
		if (inflight) return inflight
		refreshing.value = loaded.value
		inflight = get<Project[]>('ui-api/projects')
			.then((list) => {
				items.value = list
				loaded.value = true
			})
			.finally(() => {
				inflight = null
				refreshing.value = false
			})
		return inflight
	}

	async function create(body: Partial<Project>) {
		const p = await post<Project>('ui-api/projects', body)
		items.value.push(p)
		return p
	}

	/** Applies the change at once and puts the old project back if the server refuses it. */
	async function update(id: string, body: Partial<Project>) {
		const i = items.value.findIndex((x) => x.id === id)
		const before = i >= 0 ? items.value[i] : undefined
		if (before) items.value[i] = { ...before, ...body }
		try {
			const p = await patch<Project>(`ui-api/projects/${id}`, body)
			const j = items.value.findIndex((x) => x.id === id)
			if (j >= 0) items.value[j] = p
			return p
		} catch (e) {
			const j = items.value.findIndex((x) => x.id === id)
			if (before && j >= 0) items.value[j] = before
			throw e
		}
	}

	async function remove(id: string) {
		const before = items.value
		items.value = items.value.filter((x) => x.id !== id)
		try {
			await del(`ui-api/projects/${id}`)
		} catch (e) {
			items.value = before
			throw e
		}
	}

	/** Move a chat into a project, or out of all projects with projectId 'none'. */
	async function assign(projectId: string, sessionId: string) {
		await post(`ui-api/projects/${projectId}/sessions`, { sessionId })
		for (const p of items.value) p.sessionIds = p.sessionIds.filter((s) => s !== sessionId)
		items.value.find((p) => p.id === projectId)?.sessionIds.unshift(sessionId)
	}

	function forSession(sessionId: string) {
		return items.value.find((p) => p.sessionIds.includes(sessionId))
	}

	return { items, loaded, refreshing, load, create, update, remove, assign, forSession }
})
