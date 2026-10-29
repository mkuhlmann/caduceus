<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ProjectFormModal from '@/components/projects/ProjectFormModal.vue'
import ProjectDetail from '@/components/projects/ProjectDetail.vue'
import HostFolders from '@/components/projects/HostFolders.vue'
import { useApp } from '@/stores/app'
import { useProjects, PROJECT_COLORS } from '@/stores/projects'
import { useSessions } from '@/stores/sessions'
import { relative, dateTime } from '@/lib/time'

const route = useRoute()
const router = useRouter()
const app = useApp()
const projects = useProjects()
const sessions = useSessions()
const creating = ref(false)
const error = ref('')

onMounted(async () => {
	try {
		if (!projects.loaded) await projects.load()
	} catch (e) {
		error.value = (e as Error).message
	}
	if (!sessions.list.length) sessions.loadList()
})

const selected = computed(() => {
	const id = route.query.id
	return typeof id === 'string' ? projects.items.find((p) => p.id === id) : undefined
})

function lastActivity(ids: string[]) {
	let max = 0
	for (const id of ids) max = Math.max(max, sessions.byId(id)?.last_active ?? 0)
	return max || null
}

const rows = computed(() =>
	projects.items
		.map((p) => ({ p, last: lastActivity(p.sessionIds) }))
		.sort((a, b) => (b.last ?? b.p.updatedAt) - (a.last ?? a.p.updatedAt)),
)

const show = (id: string) => router.push({ path: '/projects', query: { id } })
const back = () => router.push({ path: '/projects' })
</script>

<template>
	<div class="h-full overflow-y-auto">
		<ProjectDetail v-if="selected" :project="selected" @back="back" @deleted="back" />

		<template v-else>
			<PageHeader
				title="Projects"
				subtitle="Group chats and give them standing instructions that Hermes reads at the start of each new chat."
			>
				<button class="btn-primary" @click="creating = true"><Plus :size="16" /> New project</button>
			</PageHeader>

			<div class="px-6 pb-16 md:px-10">
				<p v-if="error" class="max-w-3xl text-sm text-rose" role="alert">Could not load projects: {{ error }}</p>
				<EmptyState
					v-else-if="projects.loaded && !projects.items.length"
					title="No projects yet"
					body="Create a project for a topic you come back to, and add instructions once instead of repeating them in every chat."
				>
					<button class="btn-primary" @click="creating = true">Create a project</button>
				</EmptyState>
				<p v-else-if="!projects.loaded" class="text-ink-3" role="status">Loading projects</p>
				<ul v-else class="max-w-3xl divide-y divide-line border-y border-line">
					<li v-for="{ p, last } in rows" :key="p.id">
						<button
							class="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-surface-2/50"
							@click="show(p.id)"
						>
							<span
								class="size-3 shrink-0 rounded-full"
								:style="{ background: PROJECT_COLORS[p.color] }"
								aria-hidden="true"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium text-ink">{{ p.name }}</span>
								<span v-if="p.description" class="block truncate text-sm text-ink-2">{{ p.description }}</span>
							</span>
							<span class="shrink-0 text-right text-xs text-ink-3">
								<span class="block">{{ p.sessionIds.length }} {{ p.sessionIds.length === 1 ? 'chat' : 'chats' }}</span>
								<time v-if="last" :title="dateTime(last)">{{ relative(last) }}</time>
							</span>
						</button>
					</li>
				</ul>

				<HostFolders v-if="app.hasDashboard()" />
			</div>
		</template>

		<ProjectFormModal v-if="creating" @close="creating = false" @saved="(p) => show(p.id)" />
	</div>
</template>
