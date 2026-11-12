<script setup lang="ts">
import { computed } from 'vue'
import { dashboard } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'

/** One select over every provider's models; the value is `provider::model`, or '' for the empty choice. */
const props = defineProps<{ id: string; emptyLabel: string; current?: { provider: string; model: string } }>()
const value = defineModel<string>({ required: true })
const { data, error } = useResource('bots:model-options', () => dashboard.modelOptions())

const groups = computed(() => {
	const ps = data.value?.providers ?? []
	const c = props.current
	// A model set outside the curated lists still shows as the current choice.
	if (c?.model && !ps.some((p) => p.slug === c.provider && p.models.includes(c.model)))
		return [{ slug: c.provider, name: c.provider, models: [c.model] }, ...ps]
	return ps
})
</script>

<template>
	<select :id="id" v-model="value" class="field">
		<option value="">{{ emptyLabel }}</option>
		<optgroup v-for="p in groups" :key="p.slug" :label="p.name">
			<option v-for="m in p.models" :key="m" :value="`${p.slug}::${m}`">{{ m }}</option>
		</optgroup>
	</select>
	<p v-if="error" class="mt-1 text-sm text-rose">Could not load the model list. {{ error }}</p>
</template>
