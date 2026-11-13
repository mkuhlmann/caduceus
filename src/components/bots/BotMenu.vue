<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBots, type Bot } from '@/stores/bots'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'

/** Everything you can do to one bot: the same actions as Hermes Desktop's right-click menu. */
const props = defineProps<{ bot: Bot }>()
const emit = defineEmits<{ close: []; settings: [] }>()
const bots = useBots()
const toasts = useToasts()
const dialogs = useDialogs()
const router = useRouter()
const el = ref<HTMLElement>()
const mode = ref<'menu' | 'section'>('menu')

// The event path, not the target: a click that swaps the menu's content detaches its own target.
function onDoc(e: MouseEvent) {
	if (el.value && !e.composedPath().includes(el.value)) emit('close')
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
	emit('close')
	try {
		await fn()
		if (done) toasts.push(done)
	} catch (e) {
		toasts.error((e as Error).message)
	}
}

async function openRecent() {
	emit('close')
	try {
		const s = await bots.recentSession(props.bot.name)
		if (!s) return toasts.push(`${props.bot.displayName} has no other conversation yet`)
		router.push({ path: `/bots/${encodeURIComponent(props.bot.name)}`, query: { session: s.id } })
	} catch (e) {
		toasts.error(`Could not open a recent session: ${(e as Error).message}`)
	}
}

// Each of these closes the menu before asking, so the dialog does not open over a menu it would then dismiss.
async function newSection() {
	emit('close')
	const name = await dialogs.prompt({ title: 'New section', label: 'Name', action: 'Create section' })
	if (!name) return
	const s = bots.createSection(name)
	run(() => bots.moveToSection(props.bot.name, s), `Moved to ${s.name}`)
}

async function duplicate() {
	emit('close')
	const name = await dialogs.prompt({
		title: `Duplicate ${props.bot.displayName}`,
		label: 'Handle for the copy',
		value: `${props.bot.name === 'default' ? 'hermes' : props.bot.name}-copy`,
		hint: 'Lowercase letters, digits, - and _.',
		action: 'Duplicate bot',
	})
	if (!name) return
	run(async () => {
		const created = await bots.duplicate(props.bot.name, name.toLowerCase())
		router.push(`/bots/${encodeURIComponent(created)}`)
	}, 'Bot duplicated')
}

async function remove() {
	emit('close')
	const ok = await dialogs.confirm({
		title: `Delete ${props.bot.displayName}?`,
		body: 'Its profile on the Hermes host goes too: memory, skills, chats and settings.',
		action: 'Delete bot',
		danger: true,
	})
	if (!ok) return
	run(async () => {
		await bots.remove(props.bot.name)
		if (router.currentRoute.value.params.name === props.bot.name) router.push('/bots')
	}, 'Bot deleted')
}
</script>

<template>
	<div ref="el" class="w-56 rounded-lg border border-line bg-surface p-1 text-sm shadow-xl" role="menu">
		<template v-if="mode === 'menu'">
			<button v-if="bot.connected" class="menu-item" role="menuitem" @click="openRecent">Open recent session</button>
			<button
				class="menu-item"
				role="menuitem"
				@click="run(() => bots.saveMeta(bot.name, { pinned: !bot.pinned }), bot.pinned ? 'Bot unpinned' : 'Bot pinned')"
			>
				{{ bot.pinned ? 'Unpin' : 'Pin to top' }}
			</button>
			<button class="menu-item" role="menuitem" @click="mode = 'section'">Move to section</button>
			<button
				v-if="bot.sectionId"
				class="menu-item"
				role="menuitem"
				@click="run(() => bots.moveToSection(bot.name, null), 'Removed from section')"
			>
				Remove from section
			</button>
			<button
				class="menu-item"
				role="menuitem"
				@click="run(() => bots.saveMeta(bot.name, { hidden: !bot.hidden }), bot.hidden ? 'Bot unhidden' : 'Bot hidden')"
			>
				{{ bot.hidden ? 'Unhide bot' : 'Hide bot' }}
			</button>
			<button class="menu-item" role="menuitem" @click="duplicate">Duplicate</button>
			<button class="menu-item" role="menuitem" @click="(emit('settings'), emit('close'))">Settings</button>
			<button v-if="!bot.isDefault" class="menu-item text-rose" role="menuitem" @click="remove">Delete bot</button>
		</template>
		<template v-else>
			<button
				v-for="s in bots.sections"
				:key="s.id"
				class="menu-item"
				role="menuitem"
				:aria-current="s.id === bot.sectionId ? 'true' : undefined"
				:class="{ 'font-medium': s.id === bot.sectionId }"
				@click="run(() => bots.moveToSection(bot.name, s), `Moved to ${s.name}`)"
			>
				{{ s.name }}
			</button>
			<button class="menu-item" role="menuitem" @click="newSection">New section…</button>
			<button class="menu-item text-ink-3" role="menuitem" @click="mode = 'menu'">Back</button>
		</template>
	</div>
</template>

<style scoped>
@reference '../../style.css';
.menu-item {
	@apply block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2;
}
</style>
