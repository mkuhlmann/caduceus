<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
	<header class="flex flex-wrap items-end justify-between gap-4 px-6 pt-8 pb-5 md:px-10">
		<div class="min-w-0">
			<h1 class="display text-3xl">{{ title }}</h1>
			<p v-if="subtitle" class="mt-1 max-w-[60ch] text-ink-2">{{ subtitle }}</p>
		</div>
		<div class="flex items-center gap-2"><slot /></div>
	</header>
</template>
