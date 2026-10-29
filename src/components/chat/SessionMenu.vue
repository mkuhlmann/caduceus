<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Session } from '@/lib/gateway'
import { useSessions } from '@/stores/sessions'
import { useProjects } from '@/stores/projects'
import { useToasts } from '@/stores/toast'

const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ close: [] }>()
const sessions = useSessions()
const projects = useProjects()
const toasts = useToasts()
const router = useRouter()
const el = ref<HTMLElement>()
const mode = ref<'menu' | 'project'>('menu')

function onDoc(e: MouseEvent) {
	if (el.value && !el.value.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent) {
	if (e.key === 'Escape') emit('close')
}
onMounted(() => {
	setTimeout(() => document.addEventListener('click', onDoc))
	document.addEventListener('keydown', onKey)
	el.value?.querySelector('button')?.focus()
})
onBeforeUnmount(() => {
	document.removeEventListener('click', onDoc)
	document.removeEventListener('keydown', onKey)
})

async function run(fn: () => Promise<unknown>, done?: string) {
	try {
		await fn()
		if (done) toasts.push(done)
	} catch (e) {
		toasts.error((e as Error).message)
	}
	emit('close')
}

function rename() {
	const t = prompt('Rename chat', props.session.title ?? '')
	if (t && t.trim()) run(() => sessions.rename(props.session.id, t.trim()), 'Chat renamed')
	else emit('close')
}

function remove() {
	if (!confirm('Delete this chat and its history from Hermes? This cannot be undone.')) return emit('close')
	run(async () => {
		await sessions.remove(props.session.id)
		if (router.currentRoute.value.params.id === props.session.id) router.push('/chat')
	}, 'Chat deleted')
}
</script>

<template>
	<div ref="el" class="w-52 rounded-lg border border-line bg-surface p-1 text-sm shadow-xl" role="menu">
		<template v-if="mode === 'menu'">
			<button class="menu-item" role="menuitem" @click="rename">Rename</button>
			<button class="menu-item" role="menuitem" @click="run(() => sessions.togglePin(session.id))">
				{{ session.pinned ? 'Unpin' : 'Pin to top' }}
			</button>
			<button class="menu-item" role="menuitem" @click="mode = 'project'">Move to project</button>
			<button class="menu-item" role="menuitem" @click="run(() => sessions.archive(session.id), 'Chat archived')">
				Archive
			</button>
			<button class="menu-item text-rose" role="menuitem" @click="remove">Delete</button>
		</template>
		<template v-else>
			<button
				v-for="p in projects.items"
				:key="p.id"
				class="menu-item"
				role="menuitem"
				@click="run(() => projects.assign(p.id, session.id), `Moved to ${p.name}`)"
			>
				{{ p.name }}
			</button>
			<p v-if="!projects.items.length" class="px-2.5 py-1.5 text-ink-3">No projects yet. Create one under Projects.</p>
			<button
				v-if="projects.forSession(session.id)"
				class="menu-item"
				role="menuitem"
				@click="run(() => projects.assign('none', session.id), 'Removed from project')"
			>
				Remove from project
			</button>
		</template>
	</div>
</template>

<style scoped>
@reference '../../style.css';
.menu-item {
	@apply block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2;
}
</style>
