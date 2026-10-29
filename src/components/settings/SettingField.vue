<script setup lang="ts">
import { computed } from 'vue'
import type { SchemaField } from '@/lib/dashboard'
import ToggleSwitch from './ToggleSwitch.vue'
import { describeField } from './util'

const props = defineProps<{ name: string; field: SchemaField; value: any; changed: boolean }>()
const emit = defineEmits<{ change: [unknown] }>()

const meta = computed(() => describeField(props.name, props.field.description))
const id = computed(() => 'f-' + props.name.replace(/\W/g, '-'))
const listText = computed(() => (Array.isArray(props.value) ? props.value.map(String).join('\n') : ''))

function onNumber(e: Event) {
	const v = (e.target as HTMLInputElement).value
	if (v !== '') emit('change', Number(v))
}
function onList(e: Event) {
	emit(
		'change',
		(e.target as HTMLTextAreaElement).value
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean),
	)
}
</script>

<template>
	<div
		class="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-6"
		:class="changed && 'border-l-2 border-ink pl-3'"
	>
		<div class="min-w-0 sm:w-1/2">
			<label :id="id + '-l'" :for="id" class="block text-sm font-medium">{{ meta.label }}</label>
			<p v-if="meta.help" :id="id + '-h'" class="max-w-[60ch] text-xs text-ink-2">{{ meta.help }}</p>
		</div>
		<div class="sm:w-1/2">
			<ToggleSwitch
				v-if="field.type === 'boolean'"
				:model-value="!!value"
				:label="meta.label"
				@update:model-value="emit('change', $event)"
			/>
			<select
				v-else-if="field.type === 'select'"
				:id="id"
				class="field"
				:value="value ?? ''"
				@change="emit('change', ($event.target as HTMLSelectElement).value)"
			>
				<option
					v-for="o in [
						...new Set([...(field.options ?? []), ...(value != null && value !== '' ? [String(value)] : [])]),
					]"
					:key="o"
					:value="o"
				>
					{{ o === '' ? 'Default' : o }}
				</option>
			</select>
			<input
				v-else-if="field.type === 'number'"
				:id="id"
				class="field"
				type="number"
				step="any"
				:value="value ?? ''"
				@change="onNumber"
			/>
			<textarea
				v-else-if="field.type === 'list'"
				:id="id"
				class="field min-h-20"
				:value="listText"
				placeholder="One entry per line"
				@change="onList"
			/>
			<input
				v-else
				:id="id"
				class="field"
				type="text"
				:value="value ?? ''"
				autocomplete="off"
				@change="emit('change', ($event.target as HTMLInputElement).value)"
			/>
		</div>
	</div>
</template>
