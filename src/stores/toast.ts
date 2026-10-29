import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Toast = { id: number; text: string; kind: 'info' | 'error' }

export const useToasts = defineStore('toasts', () => {
	const items = ref<Toast[]>([])
	let n = 0
	function push(text: string, kind: Toast['kind'] = 'info') {
		const id = ++n
		items.value.push({ id, text, kind })
		setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3200)
	}
	function dismiss(id: number) {
		items.value = items.value.filter((t) => t.id !== id)
	}
	return { items, push, dismiss, error: (t: string) => push(t, 'error') }
})
