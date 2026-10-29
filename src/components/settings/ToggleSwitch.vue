<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
	<button
		type="button"
		role="switch"
		:aria-checked="modelValue"
		:aria-label="label"
		:disabled="disabled"
		class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line transition-colors disabled:opacity-50"
		:class="modelValue ? 'bg-ink' : 'bg-surface-3'"
		@click="emit('update:modelValue', !modelValue)"
	>
		<span
			class="inline-block size-3.5 rounded-full bg-bg transition-transform"
			:class="modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"
		/>
	</button>
</template>
