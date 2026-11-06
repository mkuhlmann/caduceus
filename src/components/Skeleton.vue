<script setup lang="ts">
/**
 * Placeholder shapes while a page's first data loads. It stays invisible for the first 150ms, so fast
 * answers never flash it, then fades in with a slow sheen. Replace it with the real content in the same
 * spot (same padding and row height) so nothing jumps when data arrives.
 *
 * - `rows`: list rows with a title and a meta line, separated like `divide-y divide-line` lists.
 * - `lines`: a paragraph of text lines.
 * - `cards`: blocks for board columns or panels.
 */
withDefaults(defineProps<{ variant?: 'rows' | 'lines' | 'cards'; count?: number; label?: string }>(), {
	variant: 'rows',
	count: 5,
	label: 'Loading',
})
const widths = ['62%', '48%', '74%', '55%', '68%', '42%', '58%', '70%']
</script>

<template>
	<div class="skeleton" role="status" :aria-label="label">
		<ul v-if="variant === 'rows'" class="max-w-3xl divide-y divide-line border-y border-line">
			<li v-for="i in count" :key="i" class="flex flex-col gap-2 py-3.5">
				<span class="skeleton-bar h-3.5" :style="{ width: widths[i % widths.length] }" />
				<span class="skeleton-bar h-2.5" :style="{ width: `calc(${widths[(i + 3) % widths.length]} * 0.6)` }" />
			</li>
		</ul>
		<div v-else-if="variant === 'lines'" class="flex max-w-[72ch] flex-col gap-2.5">
			<span v-for="i in count" :key="i" class="skeleton-bar h-3" :style="{ width: widths[i % widths.length] }" />
		</div>
		<div v-else class="flex gap-3 overflow-hidden">
			<div v-for="i in count" :key="i" class="flex w-64 shrink-0 flex-col gap-2">
				<span class="skeleton-bar h-3 w-24" />
				<span class="skeleton-bar h-20 rounded-lg" />
				<span v-if="i % 2" class="skeleton-bar h-14 rounded-lg" />
			</div>
		</div>
	</div>
</template>
