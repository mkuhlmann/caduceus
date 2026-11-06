<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { markdownBlocks } from '@/lib/markdown'

/**
 * Rendered markdown whose DOM is patched block by block. While a reply streams, only the block that
 * changed (usually the last) is replaced, so earlier paragraphs, tables and highlighted code are not
 * rebuilt on every token. The blocks stay direct children of the root, so `.prose-h > * + *` still applies.
 */
const props = defineProps<{ source: string; streaming?: boolean }>()
const root = ref<HTMLElement>()
let shown: { html: string; nodes: Node[] }[] = []

function patch() {
	const el = root.value
	if (!el) return
	const next = markdownBlocks(props.source, { streaming: props.streaming })
	let i = 0
	while (i < shown.length && i < next.length && shown[i]!.html === next[i]) i++
	if (i === shown.length && i === next.length) return
	for (const b of shown.slice(i)) for (const n of b.nodes) n.parentNode === el && el.removeChild(n)
	shown = shown.slice(0, i)
	const tpl = document.createElement('template')
	for (const html of next.slice(i)) {
		tpl.innerHTML = html
		const nodes = [...tpl.content.childNodes]
		el.append(tpl.content)
		shown.push({ html, nodes })
	}
}

onMounted(patch)
watch(() => [props.source, props.streaming], patch, { flush: 'post' })
</script>

<template>
	<div ref="root" />
</template>
