<script setup lang="ts">
import { reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { dashboard } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'

const emit = defineEmits<{ close: []; created: [slug: string] }>()
const toasts = useToasts()
const busy = ref(false)
const form = reactive({ name: '', slug: '' })
const slugEdited = ref(false)

function onName() {
	if (!slugEdited.value)
		form.slug = form.name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
}

async function submit() {
	busy.value = true
	try {
		await dashboard.createBoard({ slug: form.slug.trim(), name: form.name.trim() || undefined })
		toasts.push('Board created')
		emit('created', form.slug.trim())
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="New board" @close="emit('close')">
		<form id="new-board" class="space-y-4" @submit.prevent="submit">
			<div>
				<label class="label" for="nb-name">Name</label>
				<input id="nb-name" v-model="form.name" class="field" required autofocus @input="onName" />
			</div>
			<div>
				<label class="label" for="nb-slug">Short name for URLs and the CLI</label>
				<input
					id="nb-slug"
					v-model="form.slug"
					class="field"
					required
					pattern="[a-z0-9][a-z0-9\-_]*"
					@input="slugEdited = true"
				/>
				<p class="mt-1 text-xs text-ink-3">Lowercase letters, numbers and dashes.</p>
			</div>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="new-board" :disabled="busy || !form.slug.trim()">
				Create board
			</button>
		</template>
	</Modal>
</template>
