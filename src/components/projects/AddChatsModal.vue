<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { useSessions } from '@/stores/sessions'
import { useProjects, PROJECT_COLORS, type Project } from '@/stores/projects'
import { useToasts } from '@/stores/toast'
import { relative } from '@/lib/time'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()
const sessions = useSessions()
const projects = useProjects()
const toasts = useToasts()

const filter = ref('')
const picked = ref<string[]>([])
const saving = ref(false)

const rows = computed(() => {
	const q = filter.value.trim().toLowerCase()
	return sessions.visible
		.filter((s) => !props.project.sessionIds.includes(s.id))
		.filter((s) => !q || (s.title ?? '').toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q))
})

async function add() {
	saving.value = true
	try {
		for (const id of picked.value) await projects.assign(props.project.id, id)
		toasts.push(picked.value.length === 1 ? 'Chat added' : `${picked.value.length} chats added`)
		emit('close')
	} catch (e) {
		toasts.error(`Could not add the chats: ${(e as Error).message}`)
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<Modal title="Add existing chats" @close="emit('close')">
		<label class="label" for="add-filter">Filter chats</label>
		<input id="add-filter" v-model="filter" class="field" autocomplete="off" />
		<p class="mt-2 text-xs text-ink-3">A chat belongs to one project. Chats that are in another project move here.</p>
		<p v-if="!rows.length" class="py-6 text-sm text-ink-2">No chats to add.</p>
		<ul v-else class="mt-2 divide-y divide-line">
			<li v-for="s in rows" :key="s.id">
				<label class="flex cursor-pointer items-start gap-3 py-2">
					<input v-model="picked" type="checkbox" :value="s.id" class="mt-1" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm text-ink">{{ s.title || s.preview?.slice(0, 70) || 'Untitled' }}</span>
						<span class="flex items-center gap-1.5 text-xs text-ink-3">
							<template v-if="projects.forSession(s.id)">
								<span
									class="size-1.5 rounded-full"
									:style="{ background: PROJECT_COLORS[projects.forSession(s.id)!.color] }"
								/>
								In {{ projects.forSession(s.id)!.name }}
							</template>
							<time v-if="s.last_active">{{ relative(s.last_active) }}</time>
						</span>
					</span>
				</label>
			</li>
		</ul>
		<template #footer>
			<button class="btn-ghost" @click="emit('close')">Cancel</button>
			<button class="btn-primary" :disabled="!picked.length || saving" @click="add">
				{{ picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'chat' : 'chats'}` : 'Add chats' }}
			</button>
		</template>
	</Modal>
</template>
