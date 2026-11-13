<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Session } from '@/lib/gateway'
import { useSessions } from '@/stores/sessions'
import { useProjects } from '@/stores/projects'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'

const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ close: [] }>()
const sessions = useSessions()
const projects = useProjects()
const toasts = useToasts()
const dialogs = useDialogs()
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

// Both close the menu before asking, so the dialog does not open over a menu it would then dismiss.
async function rename() {
	emit('close')
	const t = await dialogs.prompt({
		title: 'Rename chat',
		label: 'Title',
		value: props.session.title ?? '',
		action: 'Rename chat',
	})
	if (t) run(() => sessions.rename(props.session.id, t), 'Chat renamed')
}

async function remove() {
	emit('close')
	const ok = await dialogs.confirm({
		title: 'Delete this chat?',
		body: 'The chat and its history are removed from Hermes and cannot be recovered.',
		action: 'Delete chat',
		danger: true,
	})
	if (!ok) return
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
