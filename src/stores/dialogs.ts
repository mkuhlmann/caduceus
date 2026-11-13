import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ConfirmOptions = {
	title: string
	/** What happens if the user goes ahead, and what they lose. */
	body: string
	/** The button that goes ahead, as a plain verb ("Delete webhook"). */
	action: string
	/** Paints the action as destructive and focuses Cancel, so Enter does not destroy anything. */
	danger?: boolean
}

export type PromptOptions = {
	title: string
	label: string
	value?: string
	hint?: string
	action: string
}

type Request =
	| { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
	| { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }

/**
 * The app's own confirm and prompt dialogs, in place of the browser's. `Dialogs.vue` shows one at a time, in the
 * order they were asked.
 */
export const useDialogs = defineStore('dialogs', () => {
	const queue = ref<Request[]>([])
	let n = 0

	function settle(id: number, value: boolean | string | null) {
		const r = queue.value.find((q) => q.id === id)
		if (!r) return
		queue.value = queue.value.filter((q) => q.id !== id)
		;(r.resolve as (v: typeof value) => void)(value)
	}

	/** Resolves true when the user goes ahead, false when they cancel or dismiss the dialog. */
	function confirm(opts: ConfirmOptions) {
		return new Promise<boolean>((resolve) => queue.value.push({ id: ++n, kind: 'confirm', opts, resolve }))
	}

	/** Resolves to the trimmed text, or null when the user cancels or leaves it empty. */
	function prompt(opts: PromptOptions) {
		return new Promise<string | null>((resolve) => queue.value.push({ id: ++n, kind: 'prompt', opts, resolve }))
	}

	return { queue, confirm, prompt, settle }
})
