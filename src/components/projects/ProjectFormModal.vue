<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { useProjects, PROJECT_COLORS, type Project } from '@/stores/projects'
import { useToasts } from '@/stores/toast'

const props = defineProps<{ project?: Project }>()
const emit = defineEmits<{ close: []; saved: [p: Project] }>()
const projects = useProjects()
const toasts = useToasts()

const name = ref(props.project?.name ?? '')
const description = ref(props.project?.description ?? '')
const instructions = ref(props.project?.instructions ?? '')
const color = ref(props.project?.color ?? 'lapis')
const saving = ref(false)
const error = ref('')

async function save() {
	if (!name.value.trim()) {
		error.value = 'Give the project a name.'
		return
	}
	saving.value = true
	error.value = ''
	try {
		const body = {
			name: name.value.trim(),
			description: description.value.trim(),
			instructions: instructions.value,
			color: color.value,
		}
		const p = props.project ? await projects.update(props.project.id, body) : await projects.create(body)
		toasts.push(props.project ? 'Project saved' : 'Project created')
		emit('saved', p)
		emit('close')
	} catch (e) {
		error.value = `Could not save the project: ${(e as Error).message}`
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<Modal :title="project ? 'Edit project' : 'New project'" @close="emit('close')">
		<form id="project-form" class="space-y-4" @submit.prevent="save">
			<div>
				<label class="label" for="p-name">Name</label>
				<input id="p-name" v-model="name" class="field" autofocus autocomplete="off" />
			</div>
			<div>
				<label class="label" for="p-desc">Description</label>
				<input id="p-desc" v-model="description" class="field" autocomplete="off" />
			</div>
			<div>
				<label class="label" for="p-inst">Instructions</label>
				<textarea id="p-inst" v-model="instructions" class="field" rows="6" aria-describedby="p-inst-help" />
				<p id="p-inst-help" class="mt-1 text-xs text-ink-3">
					Sent to Hermes at the start of every new chat in this project.
				</p>
			</div>
			<fieldset>
				<legend class="label">Color</legend>
				<div class="flex flex-wrap gap-2">
					<label
						v-for="(value, key) in PROJECT_COLORS"
						:key="key"
						class="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm capitalize has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
						:class="color === key ? 'border-ink text-ink' : 'border-line text-ink-2 hover:bg-surface-2'"
					>
						<input v-model="color" type="radio" name="p-color" :value="key" class="sr-only" />
						<span class="size-3 rounded-full" :style="{ background: value }" aria-hidden="true" />
						{{ key }}
					</label>
				</div>
			</fieldset>
			<p v-if="error" class="text-sm text-rose" role="alert">{{ error }}</p>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="project-form" :disabled="saving">
				{{ project ? 'Save project' : 'Create project' }}
			</button>
		</template>
	</Modal>
</template>
