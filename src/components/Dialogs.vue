<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import { useDialogs } from '@/stores/dialogs'

const dialogs = useDialogs()
const current = computed(() => dialogs.queue[0])
const text = ref('')

watch(
	current,
	(r) => {
		if (r?.kind === 'prompt') text.value = r.opts.value ?? ''
	},
	{ immediate: true },
)

function cancel() {
	if (current.value) dialogs.settle(current.value.id, current.value.kind === 'confirm' ? false : null)
}
function submit() {
	const r = current.value
	if (!r) return
	if (r.kind === 'confirm') return dialogs.settle(r.id, true)
	dialogs.settle(r.id, text.value.trim() || null)
}
// The prefilled text is selected, so typing replaces it as it did in the browser's prompt.
const selectAll = (e: FocusEvent) => (e.target as HTMLInputElement).select()
</script>

<template>
	<Modal v-if="current" :key="current.id" :title="current.opts.title" @close="cancel">
		<p v-if="current.kind === 'confirm'" class="max-w-[72ch] text-sm text-ink-2">{{ current.opts.body }}</p>
		<form v-else :id="`dialog-${current.id}`" @submit.prevent="submit">
			<label class="label" :for="`dialog-${current.id}-field`">{{ current.opts.label }}</label>
			<input
				:id="`dialog-${current.id}-field`"
				v-model="text"
				class="field"
				autocomplete="off"
				autofocus
				@focus="selectAll"
			/>
			<p v-if="current.opts.hint" class="mt-1 text-xs text-ink-3">{{ current.opts.hint }}</p>
		</form>
		<template #footer>
			<button
				class="btn-ghost"
				type="button"
				:autofocus="current.kind === 'confirm' && current.opts.danger"
				@click="cancel"
			>
				Cancel
			</button>
			<button
				v-if="current.kind === 'confirm'"
				:class="current.opts.danger ? 'btn-danger' : 'btn-primary'"
				type="button"
				:autofocus="!current.opts.danger"
				@click="submit"
			>
				{{ current.opts.action }}
			</button>
			<button v-else class="btn-primary" type="submit" :form="`dialog-${current.id}`" :disabled="!text.trim()">
				{{ current.opts.action }}
			</button>
		</template>
	</Modal>
</template>
