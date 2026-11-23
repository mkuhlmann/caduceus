<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Star } from 'lucide-vue-next'
import { modelKey, type ProviderModels } from '@/lib/chat-models'
import { usePreferences } from '@/stores/preferences'
import { useToasts } from '@/stores/toast'

/** Every provider's models, searchable, each with a star for the chat's model menu; `pickable` makes rows choices. */
const props = defineProps<{
	providers: ProviderModels[]
	current?: { provider: string; model: string }
	pickable?: boolean
	autofocus?: boolean
}>()
const emit = defineEmits<{ pick: [m: { provider: string; model: string }] }>()
const preferences = usePreferences()
const toasts = useToasts()
const query = ref('')

const groups = computed(() => {
	const q = query.value.trim().toLowerCase()
	return props.providers
		.map((p) => ({
			...p,
			models: q && !p.name.toLowerCase().includes(q) ? p.models.filter((m) => m.toLowerCase().includes(q)) : p.models,
		}))
		.filter((p) => p.models.length)
})
const isCurrent = (slug: string, m: string) => props.current?.provider === slug && props.current?.model === m

async function star(slug: string, model: string) {
	try {
		await preferences.toggleFavorite(modelKey({ provider: slug, model }))
	} catch (e) {
		toasts.error(`Could not save your favorites. ${(e as Error).message}`)
	}
}
</script>

<template>
	<div>
		<label class="sr-only" for="model-search">Search models</label>
		<input
			id="model-search"
			v-model="query"
			type="search"
			class="field"
			placeholder="Search models"
			autocomplete="off"
			:autofocus="autofocus"
		/>
		<p v-if="!groups.length" class="py-6 text-sm text-ink-2">No model matches “{{ query }}”.</p>
		<section v-for="p in groups" :key="p.slug" class="mt-4">
			<h3 class="mb-1 px-1 text-sm font-semibold text-ink-2">{{ p.name }}</h3>
			<ul class="divide-y divide-line">
				<li v-for="m in p.models" :key="m" class="flex items-center gap-1">
					<button
						v-if="pickable"
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2"
						:aria-current="isCurrent(p.slug, m) || undefined"
						@click="emit('pick', { provider: p.slug, model: m })"
					>
						<span class="min-w-0 flex-1 truncate">{{ m }}</span>
						<Check v-if="isCurrent(p.slug, m)" :size="16" class="shrink-0" aria-label="In use" />
					</button>
					<span v-else class="min-w-0 flex-1 truncate px-2 py-2 text-sm">{{ m }}</span>
					<button
						type="button"
						class="icon-btn size-8 shrink-0"
						:aria-label="preferences.isFavorite(modelKey({ provider: p.slug, model: m })) ? `Unstar ${m}` : `Star ${m}`"
						:aria-pressed="preferences.isFavorite(modelKey({ provider: p.slug, model: m }))"
						@click="star(p.slug, m)"
					>
						<Star
							:size="16"
							:fill="preferences.isFavorite(modelKey({ provider: p.slug, model: m })) ? 'currentColor' : 'none'"
							:class="preferences.isFavorite(modelKey({ provider: p.slug, model: m })) ? 'text-ink' : 'text-ink-3'"
						/>
					</button>
				</li>
			</ul>
		</section>
	</div>
</template>
