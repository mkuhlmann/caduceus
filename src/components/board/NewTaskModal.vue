<script setup lang="ts">
import { reactive, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { dashboard, type KanbanTask } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'

const props = defineProps<{ board?: string; assignees: string[] }>()
const emit = defineEmits<{ close: []; created: [task: KanbanTask] }>()
const toasts = useToasts()
const busy = ref(false)
const form = reactive({ title: '', body: '', assignee: '', priority: 0, triage: false })

async function submit() {
	if (!form.title.trim()) return
	busy.value = true
	try {
		const r = await dashboard.createTask(
			{
				title: form.title.trim(),
				body: form.body.trim() || undefined,
				assignee: form.assignee.trim() || undefined,
				priority: Number(form.priority) || 0,
				triage: form.triage,
			},
			props.board,
		)
		if (r.warning) toasts.push(r.warning)
		toasts.push('Task created')
		emit('created', r.task)
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="New task" @close="emit('close')">
		<form id="new-task" class="space-y-4" @submit.prevent="submit">
			<div>
				<label class="label" for="nt-title">Title</label>
				<input id="nt-title" v-model="form.title" class="field" required autofocus />
			</div>
			<div>
				<label class="label" for="nt-body">Details (markdown)</label>
				<textarea id="nt-body" v-model="form.body" class="field" rows="5" />
			</div>
			<div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
				<div>
					<label class="label" for="nt-assignee">Assignee</label>
					<input
						id="nt-assignee"
						v-model="form.assignee"
						class="field"
						list="nt-assignees"
						placeholder="Leave empty to decide later"
					/>
					<datalist id="nt-assignees"><option v-for="a in assignees" :key="a" :value="a" /></datalist>
				</div>
				<div>
					<label class="label" for="nt-priority">Priority</label>
					<input id="nt-priority" v-model.number="form.priority" class="field" type="number" step="1" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm">
				<input v-model="form.triage" type="checkbox" />
				Put in triage for Hermes to specify
			</label>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="new-task" :disabled="busy || !form.title.trim()">
				Create task
			</button>
		</template>
	</Modal>
</template>
