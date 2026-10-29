<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { DASH, post } from '@/lib/http'
import { dashboard } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'

const toasts = useToasts()
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const options = ref<Awaited<ReturnType<typeof dashboard.modelOptions>> | null>(null)
const info = ref<any>(null)
const provider = ref('')
const model = ref('')

const current = computed(() => ({
	provider: options.value?.provider ?? info.value?.provider ?? '',
	model: options.value?.model ?? info.value?.model ?? '',
}))
const models = computed(() => {
	const list = options.value?.providers.find((p) => p.slug === provider.value)?.models ?? []
	return model.value && !list.includes(model.value) ? [model.value, ...list] : list
})
const providerName = (slug: string) => options.value?.providers.find((p) => p.slug === slug)?.name ?? slug
const unchanged = computed(() => provider.value === current.value.provider && model.value === current.value.model)

async function load() {
	loading.value = true
	error.value = ''
	try {
		;[options.value, info.value] = await Promise.all([dashboard.modelOptions(), dashboard.modelInfo()])
		provider.value = current.value.provider
		model.value = current.value.model
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}
onMounted(load)
watch(provider, (p, old) => {
	if (old && p !== current.value.provider)
		model.value = options.value?.providers.find((x) => x.slug === p)?.models[0] ?? ''
	else if (p === current.value.provider) model.value = current.value.model
})

type SetResult = { ok: boolean; confirm_required?: boolean; confirm_message?: string }
const send = (confirm?: boolean) =>
	post<SetResult>(`${DASH}/api/model/set`, {
		scope: 'main',
		provider: provider.value,
		model: model.value,
		...(confirm ? { confirm_expensive_model: true } : {}),
	})

async function apply() {
	busy.value = true
	try {
		let r = await send()
		if (!r.ok && r.confirm_required) {
			if (!confirm(r.confirm_message || 'This model may be expensive. Use it anyway?')) return
			r = await send(true)
		}
		toasts.push('Model changed')
		await load()
	} catch (e) {
		toasts.error(`Could not change the model. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
const ctx = (n?: number) => (n ? `${n.toLocaleString()} tokens` : 'unknown')
</script>

<template>
	<p v-if="loading" class="text-ink-2">Loading model...</p>
	<p v-else-if="error" class="text-rose">Could not load model options. {{ error }}</p>
	<div v-else class="max-w-xl space-y-6">
		<div>
			<p class="text-sm text-ink-2">Current model</p>
			<p class="text-xl font-semibold">{{ current.model || 'None set' }}</p>
			<p class="text-sm text-ink-2">
				{{ providerName(current.provider)
				}}<template v-if="info?.effective_context_length"
					>, context window of {{ ctx(info.effective_context_length) }}</template
				>
			</p>
			<p v-if="info?.capabilities" class="mt-2 flex flex-wrap gap-1.5">
				<span v-if="info.capabilities.supports_tools" class="chip">Tools</span>
				<span v-if="info.capabilities.supports_vision" class="chip">Vision</span>
				<span v-if="info.capabilities.supports_reasoning" class="chip">Reasoning</span>
			</p>
		</div>
		<form class="space-y-4" @submit.prevent="apply">
			<div>
				<label class="label" for="m-provider">Provider</label>
				<select id="m-provider" v-model="provider" class="field">
					<option v-for="p in options?.providers" :key="p.slug" :value="p.slug">{{ p.name }}</option>
				</select>
			</div>
			<div>
				<label class="label" for="m-model">Model</label>
				<select id="m-model" v-model="model" class="field">
					<option v-for="m in models" :key="m" :value="m">{{ m }}</option>
				</select>
			</div>
			<p class="text-sm text-ink-2">
				The new model applies to new chats. Chats already running keep their current model.
			</p>
			<button class="btn-primary" type="submit" :disabled="busy || unchanged || !model">Use this model</button>
		</form>
	</div>
</template>
