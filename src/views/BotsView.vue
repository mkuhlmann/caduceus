<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Eye, EyeOff, FolderPlus, MoreHorizontal, Plus, Search } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import BotRow from '@/components/bots/BotRow.vue'
import NewBotModal from '@/components/bots/NewBotModal.vue'
import BotSettingsModal from '@/components/bots/BotSettingsModal.vue'
import { useApp } from '@/stores/app'
import { useBots, type Bot, type BotSection } from '@/stores/bots'
import { useToasts } from '@/stores/toast'

const app = useApp()
const bots = useBots()
const toasts = useToasts()
const route = useRoute()
const router = useRouter()
const creating = ref(false)
const editing = ref<Bot | null>(null)
const query = ref('')
const showHidden = ref(false)
const sectionMenu = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const closeSectionMenu = () => (sectionMenu.value = null)
onMounted(() => document.addEventListener('click', closeSectionMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeSectionMenu))

// The roster stays in the store: a revisit paints at once while a fresh copy loads.
// A cold start may learn only after mounting that the dashboard is reachable.
watch(
	() => app.hasDashboard(),
	(ok) => ok && bots.load(),
	{ immediate: true },
)
// "New bot" from the roster beside a chat lands here with the form open.
watch(
	() => route.query.new,
	(v) => {
		if (v !== '1') return
		creating.value = true
		router.replace({ query: {} })
	},
	{ immediate: true },
)

const hiddenCount = computed(() => bots.bots.filter((b) => b.hidden).length)
// A hidden bot that wrote something badges the eye, so nothing goes unnoticed.
const hiddenUnread = computed(() => bots.bots.some((b) => b.hidden && bots.unread(b.name)))
watch(hiddenCount, (n) => n === 0 && (showHidden.value = false))

const shown = computed(() => {
	const q = query.value.trim().toLowerCase()
	return bots.bots.filter(
		(b) =>
			(showHidden.value || !b.hidden) &&
			(!q || [b.displayName, b.name, b.handle, b.description].some((s) => s.toLowerCase().includes(q))),
	)
})

/** Sections in their order, then the bots filed nowhere. With no sections it is the plain list. */
const groups = computed(() => {
	const out: { section: BotSection | null; bots: Bot[] }[] = bots.sections.map((s) => ({
		section: s,
		bots: shown.value.filter((b) => b.sectionId === s.id),
	}))
	out.push({
		section: null,
		bots: shown.value.filter((b) => !b.sectionId || !bots.sections.some((s) => s.id === b.sectionId)),
	})
	// While searching, empty headings are noise.
	return query.value.trim() ? out.filter((g) => g.bots.length) : out
})

function newSection() {
	const name = prompt('Name the new section')?.trim()
	if (name) bots.createSection(name)
}

async function renameSection(s: BotSection) {
	sectionMenu.value = null
	const name = prompt('Rename section', s.name)?.trim()
	if (!name || name === s.name) return
	try {
		await bots.renameSection(s.id, name)
		toasts.push('Section renamed')
	} catch (e) {
		toasts.error(`Could not rename the section: ${(e as Error).message}`)
	}
}

async function deleteSection(s: BotSection) {
	sectionMenu.value = null
	try {
		await bots.deleteSection(s.id)
		toasts.push(`Section ${s.name} deleted. Its bots are unassigned again.`)
	} catch (e) {
		toasts.error(`Could not delete the section: ${(e as Error).message}`)
	}
}

function onDragOver(e: DragEvent, id: string) {
	if (!e.dataTransfer?.types.includes('application/x-caduceus-bot')) return
	e.preventDefault()
	dropTarget.value = id
}

async function onDrop(e: DragEvent, section: BotSection | null) {
	dropTarget.value = null
	const name = e.dataTransfer?.getData('application/x-caduceus-bot')
	if (!name) return
	e.preventDefault()
	if (bots.byName(name)?.sectionId === (section?.id ?? null)) return
	try {
		await bots.moveToSection(name, section)
		toasts.push(section ? `Moved to ${section.name}` : 'Removed from section')
	} catch (err) {
		toasts.error((err as Error).message)
	}
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader
			title="Bots"
			subtitle="Each bot is a Hermes profile with its own memory, skills, model and conversation."
		>
			<button v-if="app.hasDashboard()" class="btn-primary" @click="creating = true">
				<Plus :size="16" /> New bot
			</button>
		</PageHeader>

		<EmptyState
			v-if="!app.hasDashboard()"
			title="Bots need the dashboard"
			body="Hermes manages bots through its dashboard. Add the dashboard URL on the connection page to see and create them."
		>
			<RouterLink to="/connect" class="btn-outline">Open connection settings</RouterLink>
		</EmptyState>

		<div v-else class="px-6 pb-16 md:px-10">
			<p v-if="bots.error && !bots.loaded" class="max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm">
				Could not load the bots. {{ bots.error }}
				<button class="ml-1 underline" @click="bots.load()">Try again</button>
			</p>
			<Skeleton v-else-if="!bots.loaded" variant="rows" :count="3" label="Loading bots" class="max-w-3xl" />
			<template v-else>
				<div class="mb-2 flex max-w-3xl items-center gap-1">
					<div class="relative min-w-0 flex-1">
						<Search :size="15" class="pointer-events-none absolute top-2.5 left-2.5 text-ink-3" />
						<label class="sr-only" for="bot-search">Search bots</label>
						<input id="bot-search" v-model="query" class="field pl-8" type="search" placeholder="Search bots" />
					</div>
					<button
						v-if="hiddenCount"
						class="icon-btn relative"
						:aria-pressed="showHidden"
						:aria-label="showHidden ? 'Leave hidden bots out' : `Show ${hiddenCount} hidden bots`"
						:title="showHidden ? 'Leave hidden bots out' : `Show ${hiddenCount} hidden bots`"
						@click="showHidden = !showHidden"
					>
						<component :is="showHidden ? EyeOff : Eye" :size="17" />
						<span v-if="hiddenUnread" class="absolute top-1 right-1 size-1.5 rounded-full bg-focus" />
					</button>
					<button class="icon-btn" aria-label="New section" title="New section" @click="newSection">
						<FolderPlus :size="17" />
					</button>
				</div>

				<section v-for="g in groups" :key="g.section?.id ?? 'none'" class="max-w-3xl">
					<div
						v-if="bots.sections.length"
						class="relative mt-5 flex items-center gap-2 rounded-md px-2 py-1"
						:class="{ 'bg-surface-2 ring-1 ring-focus': dropTarget === (g.section?.id ?? 'none') }"
						@dragover="onDragOver($event, g.section?.id ?? 'none')"
						@dragleave="dropTarget = null"
						@drop="onDrop($event, g.section)"
					>
						<h2 class="flex-1 text-sm font-semibold text-ink-2" @dblclick="g.section && renameSection(g.section)">
							{{ g.section?.name ?? 'Unassigned' }}
							<span class="font-normal text-ink-3">{{ g.bots.length }}</span>
						</h2>
						<template v-if="g.section">
							<button
								class="icon-btn size-7"
								:aria-label="`${g.section.name} section actions`"
								@click.stop="sectionMenu = sectionMenu === g.section.id ? null : g.section.id"
							>
								<MoreHorizontal :size="16" />
							</button>
							<div
								v-if="sectionMenu === g.section.id"
								class="absolute top-8 right-0 z-20 w-48 rounded-lg border border-line bg-surface p-1 text-sm shadow-xl"
								role="menu"
							>
								<button class="menu-item" role="menuitem" @click="renameSection(g.section)">Rename</button>
								<button
									class="menu-item"
									role="menuitem"
									@click="(bots.moveSection(g.section.id, -1), (sectionMenu = null))"
								>
									Move up
								</button>
								<button
									class="menu-item"
									role="menuitem"
									@click="(bots.moveSection(g.section.id, 1), (sectionMenu = null))"
								>
									Move down
								</button>
								<button class="menu-item text-rose" role="menuitem" @click="deleteSection(g.section)">
									Delete section
								</button>
							</div>
						</template>
					</div>
					<ul class="divide-y divide-line">
						<BotRow v-for="b in g.bots" :key="b.name" :bot="b" @settings="editing = b" />
					</ul>
					<p v-if="g.section && !g.bots.length && !query" class="px-2 py-2 text-sm text-ink-3">
						Drag a bot here, or use Move to section in its menu.
					</p>
				</section>
				<p v-if="query && !shown.length" class="mt-4 text-sm text-ink-3">No bot matches “{{ query }}”.</p>
				<p v-if="bots.bots.length < 2" class="mt-6 max-w-[60ch] text-sm text-ink-2">
					Hermes is your only bot so far. Create one for a job you hand out often, like research or reviewing code, and
					give it its own instructions and model.
				</p>
			</template>
		</div>

		<NewBotModal v-if="creating" @close="creating = false" />
		<BotSettingsModal v-if="editing" :bot="editing" @close="editing = null" />
	</div>
</template>

<style scoped>
@reference '../style.css';
.menu-item {
	@apply block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2;
}
</style>
