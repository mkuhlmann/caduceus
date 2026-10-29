<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ConfigSection from '@/components/settings/ConfigSection.vue'
import ModelSection from '@/components/settings/ModelSection.vue'
import EnvSection from '@/components/settings/EnvSection.vue'
import InterfaceSection from '@/components/settings/InterfaceSection.vue'
import { categoryName, getIn, same, setIn } from '@/components/settings/util'
import { dashboard, type SchemaField } from '@/lib/dashboard'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import { useRouter } from 'vue-router'

const app = useApp()
const toasts = useToasts()
const router = useRouter()

const config = ref<Record<string, any>>({})
const fields = ref<Record<string, SchemaField>>({})
const order = ref<string[]>([])
const dirty = reactive<Record<string, unknown>>({})
const loading = ref(false)
const error = ref('')
const saving = ref(false)
const section = ref('model')
const search = ref('')

async function load() {
	loading.value = true
	error.value = ''
	try {
		const [c, s] = await Promise.all([dashboard.config(), dashboard.schema()])
		config.value = c
		fields.value = s.fields
		const present = new Set(Object.values(s.fields).map((f) => f.category ?? 'general'))
		const known = s.category_order.filter((c) => present.has(c))
		order.value = [...known, ...[...present].filter((c) => !known.includes(c)).sort()]
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}
onMounted(() => app.dashboard?.ok && load())

const top = [
	{ id: 'model', label: 'Model' },
	{ id: 'keys', label: 'API keys' },
	{ id: 'interface', label: 'Interface' },
	{ id: 'connection', label: 'Connection' },
]
const sections = computed(() => [...top, ...order.value.map((c) => ({ id: 'cfg:' + c, label: categoryName(c) }))])
const isConfig = computed(() => section.value.startsWith('cfg:') || !!search.value.trim())
const title = computed(() =>
	search.value.trim() ? 'Search results' : (sections.value.find((s) => s.id === section.value)?.label ?? ''),
)
const count = computed(() => Object.keys(dirty).length)

function go(id: string) {
	if (id === 'connection') return router.push('/connect')
	section.value = id
	search.value = ''
}

function change(key: string, value: unknown) {
	// Keep the original type for string fields that hold numbers in the file.
	const orig = getIn(config.value, key)
	if (typeof orig === 'number' && typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value)))
		value = Number(value)
	if (same(value, orig)) delete dirty[key]
	else dirty[key] = value
}
const discard = () => Object.keys(dirty).forEach((k) => delete dirty[k])

async function save() {
	const patch: Record<string, any> = {}
	for (const [k, v] of Object.entries(dirty)) setIn(patch, k, v)
	saving.value = true
	try {
		await dashboard.saveConfig(patch)
		for (const [k, v] of Object.entries(dirty)) setIn(config.value, k, v)
		discard()
		toasts.push('Settings saved')
	} catch (e) {
		toasts.error(`Could not save settings. ${(e as Error).message}`)
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader title="Configuration" subtitle="How Hermes behaves, which model it uses and the keys it can reach." />
		<EmptyState
			v-if="!app.dashboard?.ok"
			title="Connect the dashboard to change settings"
			body="Configuration is read and written through the Hermes dashboard."
		>
			<RouterLink to="/connect" class="btn-primary">Open connection settings</RouterLink>
		</EmptyState>

		<div v-else class="flex flex-col gap-6 px-6 pb-24 md:flex-row md:px-10">
			<nav aria-label="Settings sections" class="md:sticky md:top-4 md:w-52 md:shrink-0 md:self-start">
				<label class="label md:hidden" for="sec-select">Section</label>
				<select
					id="sec-select"
					class="field md:hidden"
					:value="section"
					@change="go(($event.target as HTMLSelectElement).value)"
				>
					<option v-for="s in sections" :key="s.id" :value="s.id">{{ s.label }}</option>
				</select>
				<ul class="hidden space-y-0.5 md:block">
					<li v-for="(s, i) in sections" :key="s.id" :class="i === top.length && 'mt-3 border-t border-line pt-3'">
						<button
							class="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
							:class="section === s.id && !search.trim() ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'"
							:aria-current="section === s.id ? 'page' : undefined"
							@click="go(s.id)"
						>
							{{ s.label }}
						</button>
					</li>
				</ul>
			</nav>

			<main class="min-w-0 max-w-3xl flex-1">
				<div class="mb-5">
					<label class="sr-only" for="cfg-search">Search all settings</label>
					<input
						id="cfg-search"
						v-model="search"
						type="search"
						class="field max-w-sm"
						placeholder="Search all settings"
						autocomplete="off"
					/>
				</div>
				<h2 class="mb-3 text-xl font-semibold">{{ title }}</h2>

				<template v-if="isConfig">
					<p v-if="error" class="text-rose">
						Could not load settings. {{ error }} <button class="underline" @click="load">Try again</button>
					</p>
					<p v-else-if="loading" class="text-ink-2">Loading settings...</p>
					<ConfigSection
						v-else
						:fields="fields"
						:config="config"
						:dirty="dirty"
						:category="section.slice(4)"
						:search="search"
						:order="order"
						@change="change"
					/>
				</template>
				<ModelSection v-else-if="section === 'model'" />
				<EnvSection v-else-if="section === 'keys'" />
				<InterfaceSection v-else-if="section === 'interface'" />
			</main>
		</div>

		<div
			v-if="count"
			class="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-surface px-6 py-3 md:px-10"
		>
			<p class="text-sm">{{ count }} unsaved {{ count === 1 ? 'change' : 'changes' }}</p>
			<div class="flex gap-2">
				<button class="btn-ghost" :disabled="saving" @click="discard">Discard</button>
				<button class="btn-primary" :disabled="saving" @click="save">Save changes</button>
			</div>
		</div>
	</div>
</template>
