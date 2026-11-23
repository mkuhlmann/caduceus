<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, Cpu } from 'lucide-vue-next'
import Modal from '@/components/Modal.vue'
import ModelList from './ModelList.vue'
import { dashboard } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import {
	REASONING_LABELS,
	keepReasoning,
	reasoningLevels,
	shortList,
	shortName,
	type ChatModel,
	type Reasoning,
} from '@/lib/chat-models'
import { usePreferences } from '@/stores/preferences'

/**
 * The chat's model in the composer: a menu of the starred models and the reasoning level, and every model behind
 * "All models". Picking only says what was picked; the chat view decides what that changes.
 */
const props = defineProps<{ current?: ChatModel; busy?: boolean }>()
const emit = defineEmits<{ pick: [choice: ChatModel] }>()
const preferences = usePreferences()
const { data, error } = useResource('bots:model-options', () => dashboard.modelOptions())
const providers = computed(() => data.value?.providers ?? [])
const providerName = (slug: string) => providers.value.find((p) => p.slug === slug)?.name ?? slug

const open = ref(false)
const all = ref(false)
const root = ref<HTMLElement>()
const menu = ref<HTMLElement>()

const items = computed(() => shortList(preferences.prefs.favoriteModels, props.current))
const levels = computed(() => (props.current ? reasoningLevels(providers.value, props.current) : []))
const isCurrent = (m: { provider: string; model: string }) =>
	props.current?.provider === m.provider && props.current?.model === m.model

function pickModel(m: { provider: string; model: string }) {
	close()
	all.value = false
	if (isCurrent(m)) return
	// The reasoning level carries over when the new model can take it.
	const { provider, model } = m
	emit('pick', { provider, model, ...optional(keepReasoning(providers.value, m, props.current?.reasoning)) })
}
function pickReasoning(r?: Reasoning) {
	if (!props.current || r === props.current.reasoning) return
	close()
	emit('pick', { provider: props.current.provider, model: props.current.model, ...optional(r) })
}
const optional = (r?: Reasoning) => (r ? { reasoning: r } : {})

function showAll() {
	close()
	all.value = true
}

function close() {
	open.value = false
}
function onDoc(e: MouseEvent) {
	if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent) {
	if (e.key === 'Escape') close()
}
function unlisten() {
	document.removeEventListener('click', onDoc)
	document.removeEventListener('keydown', onKey)
}
watch(open, async (v) => {
	if (!v) return unlisten()
	setTimeout(() => open.value && document.addEventListener('click', onDoc))
	document.addEventListener('keydown', onKey)
	await nextTick()
	// Focus starts on the model in use.
	const el = menu.value
	;(el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>('button'))?.focus()
})
onBeforeUnmount(unlisten)
</script>

<template>
	<div ref="root" class="relative min-w-0">
		<button
			type="button"
			class="btn-ghost h-8 max-w-full min-w-0 px-2"
			:disabled="busy"
			aria-haspopup="menu"
			:aria-expanded="open"
			:aria-label="current ? `Model: ${current.model}` : 'Choose a model'"
			:title="current ? `${current.model}, ${providerName(current.provider)}` : 'Choose a model'"
			@click="open = !open"
		>
			<Cpu :size="16" class="shrink-0" />
			<span class="hidden min-w-0 truncate sm:inline">{{ current ? shortName(current.model) : 'Model' }}</span>
			<span v-if="current?.reasoning" class="hidden shrink-0 text-ink-3 sm:inline">{{
				REASONING_LABELS[current.reasoning]
			}}</span>
			<ChevronDown :size="14" class="shrink-0 text-ink-3" />
		</button>

		<Transition name="rise">
			<div
				v-if="open"
				ref="menu"
				class="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-5rem)] rounded-lg border border-line bg-surface p-1 text-sm shadow-xl"
				role="menu"
				aria-label="Model"
			>
				<p v-if="error && !providers.length" class="px-2 py-1.5 text-rose">Could not load the models. {{ error }}</p>
				<button
					v-for="m in items"
					:key="`${m.provider}::${m.model}`"
					type="button"
					class="menu-item"
					role="menuitemradio"
					:aria-checked="isCurrent(m)"
					:title="m.model"
					@click="pickModel(m)"
				>
					<span class="min-w-0 flex-1 truncate">{{ shortName(m.model) }}</span>
					<span class="shrink-0 text-xs text-ink-3">{{ providerName(m.provider) }}</span>
					<Check :size="16" class="shrink-0" :class="isCurrent(m) ? '' : 'invisible'" />
				</button>
				<p v-if="!preferences.prefs.favoriteModels.length" class="px-2 py-1.5 text-ink-3">
					Star models to keep them here.
				</p>

				<template v-if="current && levels.length">
					<div class="my-1 border-t border-line" />
					<div class="px-2 py-1.5">
						<p id="reasoning-label" class="mb-1.5 text-xs text-ink-3">Reasoning</p>
						<div class="flex flex-wrap gap-1" role="group" aria-labelledby="reasoning-label">
							<button
								type="button"
								class="level"
								:aria-pressed="!current.reasoning"
								title="The model's own setting"
								@click="pickReasoning()"
							>
								Default
							</button>
							<button
								v-for="r in levels"
								:key="r"
								type="button"
								class="level"
								:aria-pressed="current.reasoning === r"
								@click="pickReasoning(r)"
							>
								{{ REASONING_LABELS[r] }}
							</button>
						</div>
					</div>
				</template>

				<div class="my-1 border-t border-line" />
				<button type="button" class="menu-item" role="menuitem" @click="showAll">All models…</button>
			</div>
		</Transition>

		<Modal v-if="all" title="All models" @close="all = false">
			<p v-if="error && !providers.length" class="text-rose">Could not load the models. {{ error }}</p>
			<ModelList v-else :providers="providers" :current="current" pickable autofocus @pick="pickModel" />
		</Modal>
	</div>
</template>

<style scoped>
@reference "../../style.css";
.menu-item {
	@apply flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2;
}
.level {
	@apply pressable rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2;
}
.level[aria-pressed='true'] {
	@apply border-ink bg-surface-2 text-ink;
}
</style>
