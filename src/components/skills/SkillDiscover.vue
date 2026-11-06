<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Check, Download } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import { dashboard, type HubSkill } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { useToasts } from '@/stores/toast'

const emit = defineEmits<{ installed: [] }>()
const toasts = useToasts()

const query = ref('')
/** The query the results belong to: follows `query` after a short pause, and at once when it is cleared. */
const searched = ref('')
const installs = ref<Record<string, { action: string; lines: string[]; running: boolean; failed?: boolean }>>({})
const done = ref(new Set<string>())
const timers = new Map<string, number>()
let debounce = 0

const official = useResource('skills:hub:official', async () => (await dashboard.hubOfficial()).skills)
const search = useResource(
	() => (searched.value ? `skills:hub:search:${searched.value}` : null),
	async () => (await dashboard.hubSearch(searched.value)).results,
)
// The last search results stay on screen while the next search loads, instead of the list going blank.
const lastResults = shallowRef<HubSkill[] | null>(null)
watch(
	() => search.data.value,
	(r) => r && (lastResults.value = r),
)

watch(query, (q) => {
	clearTimeout(debounce)
	const t = q.trim()
	if (!t) {
		searched.value = ''
		lastResults.value = null
		return
	}
	debounce = window.setTimeout(() => (searched.value = t), 350)
})

const showingResults = computed(() => !!searched.value && !!lastResults.value)
const list = computed(() => (showingResults.value ? lastResults.value! : (official.data.value ?? [])))
const pending = computed(() => !list.value.length && (official.pending.value || search.pending.value))
const refreshing = computed(
	() =>
		!pending.value &&
		(query.value.trim() !== searched.value ||
			search.pending.value ||
			search.refreshing.value ||
			(!showingResults.value && official.refreshing.value)),
)
const error = computed(() => (searched.value ? search.error.value : official.data.value ? '' : official.error.value))

const trust = (t?: string) =>
	({ builtin: 'Official', official: 'Official', trusted: 'Trusted', community: 'Community' })[t ?? ''] ?? t ?? ''

async function install(s: HubSkill) {
	const id = s.identifier
	try {
		const r = await dashboard.hubInstall(id)
		installs.value[id] = { action: r.name, lines: [], running: true }
		poll(id)
	} catch (e) {
		toasts.error(`Could not start the install. ${(e as Error).message}`)
	}
}

function poll(id: string) {
	const tick = async () => {
		const st = installs.value[id]
		if (!st) return
		try {
			const r = await dashboard.actionStatus(st.action)
			st.lines = r.lines ?? []
			if (r.running) return void timers.set(id, window.setTimeout(tick, 1500))
			st.running = false
			if (r.exit_code === 0) {
				done.value.add(id)
				toasts.push('Skill installed')
				emit('installed')
				official.reload()
			} else {
				st.failed = true
				toasts.error('The install did not finish. Check the log below.')
			}
		} catch (e) {
			st.running = false
			st.failed = true
			st.lines = [...st.lines, (e as Error).message]
		}
	}
	timers.set(id, window.setTimeout(tick, 1500))
}

onBeforeUnmount(() => {
	clearTimeout(debounce)
	timers.forEach((t) => clearTimeout(t))
})
</script>

<template>
	<div>
		<label class="label" for="hub-q">Search the hub</label>
		<input
			id="hub-q"
			v-model="query"
			type="search"
			class="field max-w-md"
			placeholder="Search by name or topic"
			autocomplete="off"
		/>
		<h2 v-if="!showingResults" class="mt-6 text-lg font-semibold">Official skills</h2>
		<div class="mt-2 h-0.5">
			<div v-if="refreshing" class="refresh-bar" role="status" aria-label="Searching the hub" />
		</div>
		<p v-if="error" class="mt-4 text-rose">Could not load skills from the hub. {{ error }}</p>
		<Skeleton v-else-if="pending" variant="rows" :count="6" label="Loading skills from the hub" />
		<p v-else-if="!list.length" class="mt-4 text-ink-2">
			{{ showingResults ? 'No skills match that search.' : 'The hub has no official skills listed.' }}
		</p>
		<ul class="divide-y divide-line">
			<li v-for="s in list" :key="s.identifier" class="py-3">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0 max-w-[72ch]">
						<p class="font-medium">
							{{ s.name }} <span v-if="s.trust_level" class="chip ml-1 align-middle">{{ trust(s.trust_level) }}</span>
						</p>
						<p class="text-sm text-ink-2">{{ s.description }}</p>
					</div>
					<span
						v-if="s.installed || done.has(s.identifier)"
						class="inline-flex shrink-0 items-center gap-1 text-sm text-verdigris"
						><Check :size="16" /> Installed</span
					>
					<button v-else class="btn-outline shrink-0" :disabled="installs[s.identifier]?.running" @click="install(s)">
						<Download :size="16" />
						{{
							installs[s.identifier]?.running
								? 'Installing...'
								: installs[s.identifier]?.failed
									? 'Try again'
									: 'Install'
						}}
					</button>
				</div>
				<pre
					v-if="installs[s.identifier]?.lines.length && !done.has(s.identifier)"
					class="mt-2 max-h-40 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs whitespace-pre-wrap text-ink-2"
					>{{ installs[s.identifier].lines.slice(-12).join('\n') }}</pre>
			</li>
		</ul>
	</div>
</template>
