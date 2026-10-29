<script setup lang="ts">
import { computed } from 'vue'
import type { SchemaField } from '@/lib/dashboard'
import SettingField from './SettingField.vue'
import { categoryName, describeField, getIn, groupOf } from './util'

const props = defineProps<{
	fields: Record<string, SchemaField>
	config: Record<string, any>
	dirty: Record<string, unknown>
	category?: string
	search?: string
	order: string[]
}>()
const emit = defineEmits<{ change: [key: string, value: unknown] }>()

type Row = { key: string; field: SchemaField; group: string; category: string }

const rows = computed<Row[]>(() => {
	const q = props.search?.trim().toLowerCase() ?? ''
	const out: Row[] = []
	for (const [key, field] of Object.entries(props.fields)) {
		const cat = field.category ?? 'general'
		if (key === 'model') continue
		if (
			q
				? !`${key} ${field.description ?? ''} ${describeField(key, field.description).label}`.toLowerCase().includes(q)
				: cat !== props.category
		)
			continue
		const cur = key in props.dirty ? props.dirty[key] : getIn(props.config, key)
		if (cur && typeof cur === 'object' && !Array.isArray(cur)) continue // structured values are not editable here
		out.push({ key, field, group: groupOf(key, cat), category: cat })
	}
	return out
})

// Search results group by section; otherwise by subheading.
const sections = computed(() => {
	const map = new Map<string, Row[]>()
	const searching = !!props.search?.trim()
	const sorted = searching
		? [...rows.value].sort((a, b) => props.order.indexOf(a.category) - props.order.indexOf(b.category))
		: rows.value
	for (const r of sorted) {
		const title = searching ? categoryName(r.category) : r.group
		if (!map.has(title)) map.set(title, [])
		map.get(title)!.push(r)
	}
	const arr = [...map.entries()].map(([title, items]) => ({ title, items }))
	return searching ? arr : arr.sort((a, b) => (a.title === '' ? -1 : b.title === '' ? 1 : 0))
})
const value = (key: string) => (key in props.dirty ? props.dirty[key] : getIn(props.config, key))
</script>

<template>
	<p v-if="!rows.length" class="text-ink-2">
		{{ search ? 'No settings match that search.' : 'Nothing to configure here.' }}
	</p>
	<section v-for="s in sections" :key="s.title" class="mb-6">
		<h3 v-if="s.title" class="mt-4 mb-1 border-b border-line pb-1 text-base font-semibold">{{ s.title }}</h3>
		<div class="divide-y divide-line">
			<SettingField
				v-for="r in s.items"
				:key="r.key"
				:name="r.key"
				:field="r.field"
				:value="value(r.key)"
				:changed="r.key in dirty"
				@change="emit('change', r.key, $event)"
			/>
		</div>
	</section>
</template>
