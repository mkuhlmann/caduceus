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

	async function load() {
		items.value = await get<Project[]>('ui-api/projects')
		loaded.value = true
	}

	async function create(body: Partial<Project>) {
		const p = await post<Project>('ui-api/projects', body)
		items.value.push(p)
		return p
	}

	async function update(id: string, body: Partial<Project>) {
		const p = await patch<Project>(`ui-api/projects/${id}`, body)
		const i = items.value.findIndex((x) => x.id === id)
		if (i >= 0) items.value[i] = p
		return p
	}

	async function remove(id: string) {
		await del(`ui-api/projects/${id}`)
		items.value = items.value.filter((x) => x.id !== id)
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

	return { items, loaded, load, create, update, remove, assign, forSession }
})
