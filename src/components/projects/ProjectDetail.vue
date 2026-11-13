<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import { gateway, type Session } from '@/lib/gateway'
import { relative, dateTime } from '@/lib/time'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useProjects, PROJECT_COLORS, type Project } from '@/stores/projects'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'
import ProjectFormModal from './ProjectFormModal.vue'
import AddChatsModal from './AddChatsModal.vue'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ back: []; deleted: [] }>()
const router = useRouter()
const sessions = useSessions()
const projects = useProjects()
const toasts = useToasts()
const dialogs = useDialogs()

// Rows only animate in or out right after the user adds or removes chats, never on the first paint.
const animate = ref(false)
let animateTimer: ReturnType<typeof setTimeout> | undefined
function animateNext() {
	animate.value = true
	clearTimeout(animateTimer)
	animateTimer = setTimeout(() => (animate.value = false), 600)
}
onBeforeUnmount(() => clearTimeout(animateTimer))

const editing = ref(false)
const adding = ref(false)
// Chats not in the sidebar list are fetched once; null means Hermes no longer has them.
const fetched = reactive<Record<string, Session | null>>({})

watchEffect(() => {
	for (const id of props.project.sessionIds) {
		if (sessions.byId(id) || id in fetched) continue
		fetched[id] = null
		gateway.session(id).then(
			(s) => (fetched[id] = s),
			() => (fetched[id] = null),
		)
	}
})

const rows = computed(() => {
	const out = props.project.sessionIds.map((id) => ({ id, s: sessions.byId(id) ?? fetched[id] ?? null }))
	return out.sort((a, b) => (b.s?.last_active ?? 0) - (a.s?.last_active ?? 0))
})

function newChat() {
	router.push({ path: '/chat', query: { project: props.project.id } })
}

async function removeChat(id: string) {
	animateNext()
	try {
		await projects.update(props.project.id, { sessionIds: props.project.sessionIds.filter((x) => x !== id) })
		toasts.push('Chat removed from project')
	} catch (e) {
		toasts.error(`Could not remove the chat: ${(e as Error).message}`)
	}
}

async function removeProject() {
	const ok = await dialogs.confirm({
		title: `Delete ${props.project.name}?`,
		body: 'Its chats stay in Hermes; only the grouping is removed.',
		action: 'Delete project',
		danger: true,
	})
	if (!ok) return
	// The store drops the project at once, so go back to the list right away.
	const removing = projects.remove(props.project.id)
	emit('deleted')
	try {
		await removing
		toasts.push('Project deleted')
	} catch (e) {
		toasts.error(`Could not delete the project: ${(e as Error).message}`)
	}
}
</script>

<template>
	<div>
		<PageHeader :title="project.name" :subtitle="project.description || undefined">
			<button class="btn-ghost" @click="emit('back')"><ArrowLeft :size="16" /> All projects</button>
			<button class="btn-outline" @click="editing = true"><Pencil :size="16" /> Edit</button>
			<button class="btn-primary" @click="newChat"><Plus :size="16" /> New chat in this project</button>
		</PageHeader>

		<div class="max-w-3xl px-6 pb-16 md:px-10">
			<div class="flex items-center gap-2 text-sm text-ink-2">
				<span class="size-2.5 rounded-full" :style="{ background: PROJECT_COLORS[project.color] }" aria-hidden="true" />
				<span v-if="project.instructions.trim()">Instructions are sent at the start of every new chat.</span>
				<span v-else>No instructions yet. Edit the project to add some.</span>
			</div>
			<p
				v-if="project.instructions.trim()"
				class="mt-2 line-clamp-4 whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-ink-2"
			>
				{{ project.instructions }}
			</p>

			<div class="mt-8 flex items-center justify-between">
				<h2 class="text-lg">Chats</h2>
				<button class="btn-outline" @click="adding = true">Add existing chats</button>
			</div>

			<p v-if="!rows.length" class="mt-3 text-ink-2">
				No chats yet. Start a new chat in this project, or add chats you already have.
			</p>
			<TransitionGroup
				v-else
				tag="ul"
				class="relative mt-3 divide-y divide-line border-y border-line"
				:name="animate ? 'rise' : 'none'"
				:leave-active-class="animate ? 'rise-leave-active absolute inset-x-0' : undefined"
			>
				<li v-for="r in rows" :key="r.id" class="flex items-center gap-1 px-2 py-2.5 hover:bg-surface-2/50">
					<button
						v-if="r.s"
						class="pressable min-w-0 flex-1 rounded-md text-left"
						@click="router.push(`/chat/${encodeURIComponent(r.id)}`)"
					>
						<span class="flex items-center gap-2">
							<span
								v-if="sessions.isRunning(r.id)"
								class="size-2 shrink-0 animate-pulse rounded-full bg-gold"
								title="Working"
							/>
							<span class="truncate font-medium text-ink">{{
								r.s.title || r.s.preview?.slice(0, 70) || 'Untitled'
							}}</span>
						</span>
						<span class="flex flex-wrap gap-x-3 text-xs text-ink-3">
							<span v-if="r.s.source">{{ sourceLabel(r.s.source) }}</span>
							<time v-if="r.s.last_active" :title="dateTime(r.s.last_active)">{{ relative(r.s.last_active) }}</time>
						</span>
					</button>
					<div v-else class="min-w-0 flex-1 text-sm text-ink-3">
						This chat is no longer in Hermes or could not be loaded.
					</div>
					<button
						class="icon-btn"
						:aria-label="r.s ? `Remove ${r.s.title || 'chat'} from project` : 'Remove from project'"
						title="Remove from project"
						@click="removeChat(r.id)"
					>
						<X :size="16" />
					</button>
				</li>
			</TransitionGroup>

			<div class="mt-10 border-t border-line pt-4">
				<button class="btn-danger" @click="removeProject"><Trash2 :size="16" /> Delete project</button>
			</div>
		</div>

		<ProjectFormModal v-if="editing" :project="project" @close="editing = false" />
		<AddChatsModal v-if="adding" :project="project" @adding="animateNext" @close="adding = false" />
	</div>
</template>
