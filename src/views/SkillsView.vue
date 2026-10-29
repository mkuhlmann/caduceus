<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ToggleSwitch from '@/components/settings/ToggleSwitch.vue'
import SkillDetailModal from '@/components/skills/SkillDetailModal.vue'
import SkillCreateModal from '@/components/skills/SkillCreateModal.vue'
import SkillDiscover from '@/components/skills/SkillDiscover.vue'
import { provenanceLabel } from '@/components/skills/frontmatter'
import { dashboard, type Skill } from '@/lib/dashboard'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'

const app = useApp()
const toasts = useToasts()

const tab = ref<'installed' | 'discover'>('installed')
const skills = ref<Skill[]>([])
const loading = ref(false)
const error = ref('')
const filter = ref('')
const disabledOnly = ref(false)
const open = ref<string | null>(null)
const creating = ref(false)

async function load() {
	loading.value = true
	error.value = ''
	try {
		skills.value = await dashboard.skills()
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}
onMounted(() => app.dashboard?.ok && load())

const groups = computed(() => {
	const q = filter.value.trim().toLowerCase()
	const map = new Map<string, Skill[]>()
	for (const s of skills.value) {
		if (disabledOnly.value && s.enabled) continue
		if (q && !`${s.name} ${s.description}`.toLowerCase().includes(q)) continue
		const c = s.category || 'Other'
		if (!map.has(c)) map.set(c, [])
		map.get(c)!.push(s)
	}
	return [...map.entries()]
		.sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
		.map(([name, items]) => ({ name, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
})
const categories = computed(() => [...new Set(skills.value.map((s) => s.category).filter(Boolean) as string[])].sort())
const disabledCount = computed(() => skills.value.filter((s) => !s.enabled).length)
const pretty = (c: string) => c.replace(/[-_]/g, ' ').replace(/^./, (x) => x.toUpperCase())

async function toggle(s: Skill, enabled: boolean) {
	s.enabled = enabled
	try {
		await dashboard.toggleSkill(s.name, enabled)
		toasts.push(enabled ? 'Skill enabled' : 'Skill disabled')
	} catch (e) {
		s.enabled = !enabled
		toasts.error(`Could not change ${s.name}. ${(e as Error).message}`)
	}
}

const used = (n: number) => (n === 0 ? 'Not used yet' : n === 1 ? 'Used once' : `Used ${n} times`)
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader title="Skills" subtitle="Reusable instructions Hermes can pick up when a task calls for them.">
			<button v-if="app.dashboard?.ok" class="btn-primary" @click="creating = true">
				<Plus :size="16" /> New skill
			</button>
		</PageHeader>

		<EmptyState
			v-if="!app.dashboard?.ok"
			title="Connect the dashboard to manage skills"
			body="Skills are managed through the Hermes dashboard."
		>
			<RouterLink to="/connect" class="btn-primary">Open connection settings</RouterLink>
		</EmptyState>

		<div v-else class="px-6 pb-16 md:px-10">
			<div role="tablist" class="mb-5 flex gap-1 border-b border-line">
				<button
					v-for="t in [
						{ id: 'installed', label: 'Installed' },
						{ id: 'discover', label: 'Discover' },
					] as const"
					:key="t.id"
					role="tab"
					:aria-selected="tab === t.id"
					class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
					:class="tab === t.id ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'"
					@click="tab = t.id"
				>
					{{ t.label }}
				</button>
			</div>

			<template v-if="tab === 'installed'">
				<div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
					<div class="w-full max-w-xs">
						<label class="sr-only" for="skill-filter">Filter skills</label>
						<input
							id="skill-filter"
							v-model="filter"
							type="search"
							class="field"
							placeholder="Filter skills"
							autocomplete="off"
						/>
					</div>
					<label class="flex items-center gap-2 text-sm text-ink-2">
						<ToggleSwitch v-model="disabledOnly" label="Show disabled only" /> Show disabled only
						<span v-if="disabledCount" class="text-ink-3">({{ disabledCount }})</span>
					</label>
				</div>

				<p v-if="error" class="text-rose">
					Could not load skills. {{ error }} <button class="underline" @click="load">Try again</button>
				</p>
				<p v-else-if="loading && !skills.length" class="text-ink-2">Loading skills...</p>
				<p v-else-if="!groups.length" class="text-ink-2">
					{{
						skills.length
							? 'No skills match your filter.'
							: 'No skills installed yet. Look in Discover or write your own.'
					}}
				</p>

				<section v-for="g in groups" :key="g.name" class="mb-8 max-w-4xl">
					<h2 class="mb-1 text-lg font-semibold">{{ pretty(g.name) }}</h2>
					<ul class="divide-y divide-line border-y border-line">
						<li v-for="s in g.items" :key="s.name" class="flex items-center gap-4 py-3">
							<button class="min-w-0 flex-1 rounded text-left" @click="open = s.name">
								<p class="font-medium" :class="!s.enabled && 'text-ink-3'">{{ s.name }}</p>
								<p class="line-clamp-2 text-sm text-ink-2">{{ s.description }}</p>
								<p class="mt-0.5 text-xs text-ink-3">
									{{ provenanceLabel(s.provenance) }}, {{ used(s.usage).toLowerCase() }}
								</p>
							</button>
							<ToggleSwitch
								:model-value="s.enabled"
								:label="`${s.enabled ? 'Disable' : 'Enable'} ${s.name}`"
								@update:model-value="toggle(s, $event)"
							/>
						</li>
					</ul>
				</section>
			</template>

			<SkillDiscover v-else class="max-w-4xl" @installed="load" />
		</div>

		<SkillDetailModal v-if="open" :name="open" @close="open = null" />
		<SkillCreateModal v-if="creating" :categories="categories" @close="creating = false" @created="load" />
	</div>
</template>
