<script setup lang="ts">
import { computed } from 'vue'
import { nameForms } from '@/lib/mentions'

/**
 * Plain text with its @mentions shown as references: a tag that names a known bot (or `@all`, `@everyone`,
 * `@user`) reads in the accent colour; unknown words and e-mail addresses stay plain.
 */
const props = defineProps<{
	text: string
	bots: { name: string; handle: string; title: string }[]
}>()

const known = computed(() => {
	const s = new Set(['all', 'everyone', 'user'])
	for (const b of props.bots) {
		s.add(b.handle.toLowerCase())
		s.add(b.name.toLowerCase())
		for (const f of nameForms(b.title)) s.add(f)
	}
	return s
})

const parts = computed(() => {
	const out: { text: string; mention: boolean }[] = []
	let last = 0
	for (const m of props.text.matchAll(/(^|\s)(@([a-z0-9][a-z0-9_-]*))/gi)) {
		const at = m.index! + m[1]!.length
		if (!known.value.has(m[3]!.toLowerCase())) continue
		if (at > last) out.push({ text: props.text.slice(last, at), mention: false })
		out.push({ text: m[2]!, mention: true })
		last = at + m[2]!.length
	}
	if (last < props.text.length) out.push({ text: props.text.slice(last), mention: false })
	return out
})
</script>

<template>
	<span
		><template v-for="(p, i) in parts" :key="i"
			><span v-if="p.mention" class="font-medium text-focus">{{ p.text }}</span
			><template v-else>{{ p.text }}</template></template
		></span
	>
</template>
