<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Skeleton from '@/components/Skeleton.vue'
import { put } from '@/lib/http'
import { rpc } from '@/lib/rpc'

/**
 * Which skills, toolsets and MCP servers one bot may use: Hermes Desktop's Capabilities tab. Each list is saved as
 * a whole (Hermes replaces it), and only lists that changed are sent.
 */
const props = defineProps<{ name: string }>()

type Skill = { name: string; enabled: boolean }
type Toolset = { name: string; label?: string; description?: string; tool_count?: number; enabled: boolean }
type Mcp = { name: string; enabled: boolean; transport?: string }

const skills = ref<Skill[]>([])
const toolsets = ref<Toolset[]>([])
const mcp = ref<Mcp[]>([])
let initial = ''
const loading = ref(true)
const error = ref('')
const filter = ref('')

onMounted(async () => {
	try {
		const d = await rpc<{ skills: Skill[]; toolsets: Toolset[]; mcp_servers: Mcp[] }>('profiles.describe', {
			name: props.name,
		})
		skills.value = (d.skills ?? []).sort((a, b) => a.name.localeCompare(b.name))
		toolsets.value = d.toolsets ?? []
		mcp.value = d.mcp_servers ?? []
		initial = snapshot()
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
})

function snapshot() {
	return JSON.stringify([skills.value, toolsets.value, mcp.value])
}

const dirty = computed(() => !loading.value && !error.value && snapshot() !== initial)
const shownSkills = computed(() => {
	const q = filter.value.trim().toLowerCase()
	return q ? skills.value.filter((s) => s.name.toLowerCase().includes(q)) : skills.value
})

function setAll(list: { enabled: boolean }[], on: boolean) {
	for (const x of list) x.enabled = on
}

/** Save what changed. The parent calls this from its own Save button. */
async function save() {
	if (!dirty.value) return
	const [s0, t0, m0] = JSON.parse(initial) as [Skill[], Toolset[], Mcp[]]
	const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)
	await put(`ui-api/bots/${encodeURIComponent(props.name)}/capabilities`, {
		...(changed(s0, skills.value)
			? { disabled_skills: skills.value.filter((s) => !s.enabled).map((s) => s.name) }
			: {}),
		...(changed(t0, toolsets.value)
			? { enabled_toolsets: toolsets.value.filter((t) => t.enabled).map((t) => t.name) }
			: {}),
		...(changed(m0, mcp.value) ? { enabled_mcp_servers: mcp.value.filter((m) => m.enabled).map((m) => m.name) } : {}),
	})
	initial = snapshot()
}

defineExpose({ save, dirty })
</script>

<template>
	<p v-if="error" class="text-sm text-rose">Could not load this bot’s capabilities. {{ error }}</p>
	<Skeleton v-else-if="loading" variant="lines" :count="6" label="Loading capabilities" />
	<div v-else class="flex flex-col gap-5">
		<fieldset>
			<div class="mb-1 flex items-center justify-between gap-2">
				<legend class="label mb-0">Toolsets</legend>
				<span class="flex gap-1">
					<button type="button" class="btn-ghost h-7" @click="setAll(toolsets, true)">All</button>
					<button type="button" class="btn-ghost h-7" @click="setAll(toolsets, false)">None</button>
				</span>
			</div>
			<ul class="divide-y divide-line rounded-lg border border-line">
				<li v-for="t in toolsets" :key="t.name">
					<label class="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm">
						<input v-model="t.enabled" type="checkbox" class="mt-1" />
						<span class="min-w-0">
							<span class="block font-medium">{{ t.label || t.name }}</span>
							<span v-if="t.description" class="block truncate text-ink-3">{{ t.description }}</span>
						</span>
					</label>
				</li>
			</ul>
		</fieldset>

		<fieldset v-if="mcp.length">
			<legend class="label">MCP servers</legend>
			<ul class="divide-y divide-line rounded-lg border border-line">
				<li v-for="m in mcp" :key="m.name">
					<label class="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
						<input v-model="m.enabled" type="checkbox" />
						<span class="font-medium">{{ m.name }}</span>
						<span v-if="m.transport" class="text-ink-3">{{ m.transport }}</span>
					</label>
				</li>
			</ul>
		</fieldset>

		<fieldset>
			<div class="mb-1 flex items-center justify-between gap-2">
				<legend class="label mb-0">Skills {{ skills.filter((s) => s.enabled).length }}/{{ skills.length }}</legend>
				<span class="flex gap-1">
					<button type="button" class="btn-ghost h-7" @click="setAll(skills, true)">All</button>
					<button type="button" class="btn-ghost h-7" @click="setAll(skills, false)">None</button>
				</span>
			</div>
			<label class="sr-only" for="cap-skill-filter">Filter skills</label>
			<input id="cap-skill-filter" v-model="filter" class="field mb-2" type="search" placeholder="Filter skills" />
			<ul class="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
				<li v-for="s in shownSkills" :key="s.name">
					<label class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm">
						<input v-model="s.enabled" type="checkbox" />
						<span>{{ s.name }}</span>
					</label>
				</li>
			</ul>
		</fieldset>
	</div>
</template>
