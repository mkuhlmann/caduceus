<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'

defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()

onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
	<dialog
		ref="dialog"
		class="m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
		:class="wide ? 'max-w-3xl' : 'max-w-lg'"
		@cancel.prevent="emit('close')"
		@click.self="emit('close')"
	>
		<div class="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
			<h2 class="text-lg">{{ title }}</h2>
			<button class="icon-btn" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
		</div>
		<div class="max-h-[75vh] overflow-y-auto px-5 py-4">
			<slot />
		</div>
		<div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-3">
			<slot name="footer" />
		</div>
	</dialog>
</template>
