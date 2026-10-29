<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { dashboard } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'

type Env = Awaited<ReturnType<typeof dashboard.env>>
const toasts = useToasts()
const env = ref<Env>({})
const loading = ref(true)
const error = ref('')
const q = ref('')
const advanced = ref(false)
const editing = ref<string | null>(null)
const secret = ref('')
const busy = ref(false)

const NAMES: Record<string, string> = {
	provider: 'Model providers',
	messaging: 'Messaging',
	tool: 'Tools',
	custom: 'Custom',
	skill: 'Skills',
	setting: 'Other',
}
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function load() {
	loading.value = true
	error.value = ''
	try {
		env.value = await dashboard.env()
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}
onMounted(load)

const groups = computed(() => {
	const needle = q.value.trim().toLowerCase()
	const map = new Map<string, [string, Env[string]][]>()
	for (const [key, v] of Object.entries(env.value)) {
		if (v.advanced && !advanced.value && !v.is_set) continue
		if (needle && !`${key} ${v.description ?? ''}`.toLowerCase().includes(needle)) continue
		const c = v.category ?? 'setting'
		if (!map.has(c)) map.set(c, [])
		map.get(c)!.push([key, v])
	}
	return [...map.entries()].map(([c, items]) => ({
		id: c,
		name: NAMES[c] ?? sentence(c),
		anySet: items.some(([, v]) => v.is_set),
		items: items.sort((a, b) => Number(b[1].is_set) - Number(a[1].is_set) || a[0].localeCompare(b[0])),
	}))
})

function start(key: string) {
	secret.value = ''
	editing.value = key
}
async function save() {
	if (!editing.value) return
	busy.value = true
	try {
		await dashboard.setEnv(editing.value, secret.value)
		toasts.push('Key saved')
		editing.value = null
		await load()
	} catch (e) {
		toasts.error(`Could not save the key. ${(e as Error).message}`)
	} finally {
		busy.value = false
		secret.value = ''
	}
}
async function remove(key: string) {
	if (!confirm(`Remove ${key}? Hermes will stop using it.`)) return
	try {
		await dashboard.deleteEnv(key)
		toasts.push('Key removed')
		await load()
	} catch (e) {
		toasts.error(`Could not remove the key. ${(e as Error).message}`)
	}
}
</script>

<template>
	<div class="max-w-3xl">
		<p class="mb-4 max-w-[60ch] text-sm text-ink-2">
			Keys and tokens Hermes uses to reach providers and services. Saved values are never shown again.
		</p>
		<div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
			<div class="w-full max-w-xs">
				<label class="sr-only" for="env-q">Filter keys</label>
				<input id="env-q" v-model="q" type="search" class="field" placeholder="Filter keys" autocomplete="off" />
			</div>
			<label class="flex items-center gap-2 text-sm text-ink-2"
				><ToggleSwitch v-model="advanced" label="Show advanced" /> Show advanced</label
			>
		</div>
		<p v-if="loading && !Object.keys(env).length" class="text-ink-2">Loading keys...</p>
		<p v-else-if="error" class="text-rose">Could not load keys. {{ error }}</p>
		<p v-else-if="!groups.length" class="text-ink-2">No keys match.</p>
		<details v-for="g in groups" :key="g.id" class="mb-3 border-b border-line pb-2" :open="g.anySet || !!q.trim()">
			<summary class="cursor-pointer py-2 text-lg font-semibold">
				{{ g.name }} <span class="text-sm font-normal text-ink-3">({{ g.items.length }})</span>
			</summary>
			<ul class="divide-y divide-line">
				<li v-for="[key, v] in g.items" :key="key" class="flex items-center justify-between gap-4 py-2.5">
					<div class="min-w-0">
						<p class="text-sm font-medium">{{ v.description || key }}</p>
						<p class="break-all font-mono text-xs text-ink-3">{{ key }}</p>
						<p v-if="v.is_set" class="text-xs text-verdigris">
							Saved <span v-if="v.redacted_value" class="font-mono text-ink-3">{{ v.redacted_value }}</span>
						</p>
						<p v-else class="text-xs text-ink-3">Not set</p>
					</div>
					<div class="flex shrink-0 gap-1">
						<button class="btn-outline" @click="start(key)">{{ v.is_set ? 'Replace' : 'Set' }}</button>
						<button v-if="v.is_set" class="btn-danger" @click="remove(key)">Remove</button>
					</div>
				</li>
			</ul>
		</details>

		<Modal v-if="editing" :title="env[editing]?.is_set ? 'Replace key' : 'Set key'" @close="editing = null">
			<form id="env-form" class="space-y-3" @submit.prevent="save">
				<p class="text-sm text-ink-2">{{ env[editing]?.description }}</p>
				<div>
					<label class="label" for="env-val">{{ editing }}</label>
					<input
						id="env-val"
						v-model="secret"
						:type="env[editing]?.is_password === false ? 'text' : 'password'"
						class="field"
						autocomplete="off"
						required
					/>
				</div>
				<a v-if="env[editing]?.url" :href="env[editing]!.url" target="_blank" rel="noopener" class="text-sm underline"
					>Where to get this key</a
				>
			</form>
			<template #footer>
				<button class="btn-ghost" type="button" @click="editing = null">Cancel</button>
				<button class="btn-primary" type="submit" form="env-form" :disabled="busy || !secret">Save key</button>
			</template>
		</Modal>
	</div>
</template>
