<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import Skeleton from '@/components/Skeleton.vue'
import ConfigSection from '@/components/settings/ConfigSection.vue'
import ModelSection from '@/components/settings/ModelSection.vue'
import EnvSection from '@/components/settings/EnvSection.vue'
import InterfaceSection from '@/components/settings/InterfaceSection.vue'
import ConnectionSection from '@/components/settings/ConnectionSection.vue'
import { categoryName, getIn, same, setIn } from '@/components/settings/util'
import { dashboard } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import { useRoute, useRouter } from 'vue-router'

const app = useApp()
const toasts = useToasts()
const route = useRoute()
const router = useRouter()

const res = useResource(
	() => (app.dashboard?.ok ? 'settings:config' : null),
	async () => {
		const [config, s] = await Promise.all([dashboard.config(), dashboard.schema()])
		const present = new Set(Object.values(s.fields).map((f) => f.category ?? 'general'))
		const known = s.category_order.filter((c) => present.has(c))
		const order = [...known, ...[...present].filter((c) => !known.includes(c)).sort()]
		return { config, fields: s.fields, order }
	},
)
const config = computed(() => res.data.value?.config ?? {})
const fields = computed(() => res.data.value?.fields ?? {})
const order = computed(() => res.data.value?.order ?? [])
const loading = computed(() => res.pending.value)
const error = computed(() => (res.data.value ? '' : res.error.value))
const load = () => res.reload()
const dirty = reactive<Record<string, unknown>>({})
const saving = ref(false)
const search = ref('')

type Section = { id: string; label: string }
/** Caduceus's own settings: they change this app, never the agent, and work without the dashboard. */
const caduceus: Section[] = [
	{ id: 'interface', label: 'Interface' },
	{ id: 'connection', label: 'Connection' },
]
/** Hermes' settings, read and written through its dashboard; the config categories follow these two. */
const hermesTop: Section[] = [
	{ id: 'model', label: 'Model' },
	{ id: 'keys', label: 'API keys' },
]
const categories = computed(() => order.value.map((c) => ({ id: 'cfg:' + c, label: categoryName(c) })))
const hermes = computed(() => [...hermesTop, ...categories.value])

// The section is part of the address, so a link can open one and the back button leaves Settings.
const section = computed(() => {
	const s = route.params.section
	return (typeof s === 'string' && s) || (app.dashboard?.ok ? 'model' : 'connection')
})
const inCaduceus = computed(() => caduceus.some((s) => s.id === section.value) && !search.value.trim())
const isConfig = computed(() => section.value.startsWith('cfg:') || !!search.value.trim())
const title = computed(() =>
	search.value.trim()
		? 'Search results'
		: ([...caduceus, ...hermes.value].find((s) => s.id === section.value)?.label ??
			categoryName(section.value.slice(4))),
)
const count = computed(() => Object.keys(dirty).length)

function go(id: string) {
	search.value = ''
	router.replace({ name: 'settings', params: { section: id } })
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
		const saved = Object.entries(dirty)
		res.mutate((d) => {
			if (!d) return d
			const next = structuredClone(d.config)
			for (const [k, v] of saved) setIn(next, k, v)
			return { ...d, config: next }
		})
		discard()
		toasts.push('Settings saved')
		load()
	} catch (e) {
		toasts.error(`Could not save settings. ${(e as Error).message}`)
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader
			title="Settings"
			subtitle="Caduceus is this app. Hermes is the agent it talks to. Each has its own settings."
		/>

		<div class="flex flex-col gap-6 px-6 pb-24 md:flex-row md:px-10">
			<nav aria-label="Settings sections" class="md:sticky md:top-4 md:w-52 md:shrink-0 md:self-start">
				<label class="label md:hidden" for="sec-select">Section</label>
				<select
					id="sec-select"
					class="field md:hidden"
					:value="search.trim() ? '' : section"
					@change="go(($event.target as HTMLSelectElement).value)"
				>
					<option v-if="search.trim()" value="" disabled>Search results</option>
					<optgroup label="Caduceus">
						<option v-for="s in caduceus" :key="s.id" :value="s.id">{{ s.label }}</option>
					</optgroup>
					<optgroup label="Hermes">
						<template v-if="app.dashboard?.ok">
							<option v-for="s in hermes" :key="s.id" :value="s.id">{{ s.label }}</option>
						</template>
						<option v-else value="" disabled>Connect the dashboard first</option>
					</optgroup>
				</select>

				<div class="hidden md:block">
					<h2 id="nav-caduceus" class="px-2.5 pb-1 text-xs font-medium text-ink-3">Caduceus</h2>
					<ul class="space-y-0.5" aria-labelledby="nav-caduceus">
						<li v-for="s in caduceus" :key="s.id">
							<button
								class="pressable w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
								:class="section === s.id && !search.trim() ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'"
								:aria-current="section === s.id && !search.trim() ? 'page' : undefined"
								@click="go(s.id)"
							>
								{{ s.label }}
							</button>
						</li>
					</ul>

					<h2 id="nav-hermes" class="mt-5 border-t border-line px-2.5 pt-4 pb-1 text-xs font-medium text-ink-3">
						Hermes
					</h2>
					<ul v-if="app.dashboard?.ok" class="space-y-0.5" aria-labelledby="nav-hermes">
						<li
							v-for="(s, i) in hermes"
							:key="s.id"
							:class="i === hermesTop.length && 'mt-2 border-t border-line pt-2'"
						>
							<button
								class="pressable w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
								:class="section === s.id && !search.trim() ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'"
								:aria-current="section === s.id && !search.trim() ? 'page' : undefined"
								@click="go(s.id)"
							>
								{{ s.label }}
							</button>
						</li>
					</ul>
					<p v-else class="px-2.5 text-sm text-ink-3">
						Read and changed through the Hermes dashboard, which is not connected.
					</p>
				</div>
			</nav>

			<main class="min-w-0 max-w-3xl flex-1">
				<div v-if="app.dashboard?.ok && !inCaduceus" class="mb-5">
					<label class="sr-only" for="cfg-search">Search Hermes settings</label>
					<input
						id="cfg-search"
						v-model="search"
						type="search"
						class="field max-w-sm"
						placeholder="Search Hermes settings"
						autocomplete="off"
					/>
				</div>
				<h2 class="text-xl font-semibold">{{ title }}</h2>
				<p class="mt-1 mb-5 max-w-[60ch] text-sm text-ink-3">
					{{
						inCaduceus
							? 'Changes Caduceus only. Hermes, and anything else that talks to it, stays as it is.'
							: 'Changes Hermes itself, so it applies to every chat, bot and app that uses this agent.'
					}}
				</p>

				<InterfaceSection v-if="inCaduceus && section === 'interface'" />
				<ConnectionSection v-else-if="inCaduceus && section === 'connection'" />
				<div v-else-if="!app.dashboard?.ok" class="max-w-md space-y-3">
					<p class="text-ink-2">
						Hermes' settings are read and changed through its dashboard. Add the dashboard's address under Connection to
						change them here.
					</p>
					<button class="btn-primary" @click="go('connection')">Open connection settings</button>
				</div>
				<template v-else-if="isConfig">
					<p v-if="error" class="text-rose">
						Could not load settings. {{ error }} <button class="underline" @click="load">Try again</button>
					</p>
					<Skeleton v-else-if="loading" variant="rows" :count="6" label="Loading settings" />
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
			</main>
		</div>

		<Transition name="rise">
			<div
				v-if="count"
				class="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-surface px-6 py-3 md:px-10"
			>
				<p class="text-sm">{{ count }} unsaved {{ count === 1 ? 'change' : 'changes' }} to Hermes</p>
				<div class="flex gap-2">
					<button class="btn-ghost" :disabled="saving" @click="discard">Discard</button>
					<button class="btn-primary" :disabled="saving" @click="save">Save changes</button>
				</div>
			</div>
		</Transition>
	</div>
</template>
