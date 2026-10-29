<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { dashboard } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'
import { skillTemplate } from './frontmatter'

defineProps<{ categories: string[] }>()
const emit = defineEmits<{ close: []; created: [] }>()
const toasts = useToasts()

const name = ref('')
const category = ref('')
const content = ref(skillTemplate())
const busy = ref(false)

function onName() {
	// Keep the frontmatter name and heading in step with the field until the user rewrites them.
	const n = name.value.trim() || 'my-skill'
	content.value = content.value.replace(/^name:.*$/m, `name: ${n}`).replace(/^# .*$/m, `# ${n}`)
}

async function create() {
	busy.value = true
	try {
		await dashboard.createSkill(name.value.trim(), content.value, category.value.trim() || undefined)
		toasts.push('Skill created')
		emit('created')
		emit('close')
	} catch (e) {
		toasts.error(`Could not create the skill. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="New skill" wide @close="emit('close')">
		<form id="new-skill" class="space-y-4" @submit.prevent="create">
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="ns-name">Name</label>
					<input
						id="ns-name"
						v-model="name"
						class="field"
						required
						placeholder="release-notes"
						autocomplete="off"
						@input="onName"
					/>
					<p class="mt-1 text-xs text-ink-3">Lowercase letters, numbers and hyphens.</p>
				</div>
				<div>
					<label class="label" for="ns-cat">Category (optional)</label>
					<input
						id="ns-cat"
						v-model="category"
						class="field"
						list="ns-cats"
						placeholder="productivity"
						autocomplete="off"
					/>
					<datalist id="ns-cats"><option v-for="c in categories" :key="c" :value="c" /></datalist>
				</div>
			</div>
			<div>
				<label class="label" for="ns-content">SKILL.md</label>
				<textarea
					id="ns-content"
					v-model="content"
					class="field min-h-[40vh] font-mono text-xs"
					spellcheck="false"
					required
				/>
			</div>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="new-skill" :disabled="busy || !name.trim()">Create skill</button>
		</template>
	</Modal>
</template>
