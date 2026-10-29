<script setup lang="ts">
defineProps<{ title: string; body?: string }>()
</script>

<template>
	<div class="flex max-w-md flex-col items-start gap-3 px-6 py-12 md:px-10">
		<h2 class="text-xl">{{ title }}</h2>
		<p v-if="body" class="text-ink-2">{{ body }}</p>
		<slot />
	</div>
</template>
