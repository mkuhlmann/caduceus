<script setup lang="ts">
import { useToasts } from '@/stores/toast'
const toasts = useToasts()
</script>

<template>
	<div
		class="pointer-events-none fixed right-4 bottom-20 z-50 flex flex-col items-end gap-2 md:bottom-4"
		aria-live="polite"
	>
		<div
			v-for="t in toasts.items"
			:key="t.id"
			class="pointer-events-auto max-w-sm rounded-lg border px-3.5 py-2.5 text-sm shadow-lg"
			:class="t.kind === 'error' ? 'border-rose/40 bg-rose-soft text-ink' : 'border-line bg-surface text-ink'"
			role="status"
			@click="toasts.dismiss(t.id)"
		>
			{{ t.text }}
		</div>
	</div>
</template>
