<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Modal from '@/components/Modal.vue'
import Skeleton from '@/components/Skeleton.vue'
import { dashboard, type KanbanTask } from '@/lib/dashboard'
import { renderMarkdown } from '@/lib/markdown'
import { useResource } from '@/lib/resource'
import { dateTime, relative } from '@/lib/time'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'
import { label, targets } from './columns'

/** `initial` is the card the user tapped, so the title shows at once while the full task loads. */
const props = defineProps<{ id: string; board?: string; assignees: string[]; initial?: KanbanTask }>()
const emit = defineEmits<{ close: []; changed: []; move: [id: string, to: string] }>()
const toasts = useToasts()
const dialogs = useDialogs()

const res = useResource(
	() => `kanban:task:${props.board ?? ''}:${props.id}`,
	() => dashboard.task(props.id, props.board),
)
const task = computed(() => res.data.value?.task ?? null)
const comments = computed(() => res.data.value?.comments ?? [])
const events = computed(() => res.data.value?.events ?? [])
const runs = computed(() => res.data.value?.runs ?? [])
const loadError = computed(() => (res.data.value ? '' : res.error.value))
const assignee = ref('')
const priority = ref(0)
const comment = ref('')
const busy = ref(false)
const load = () => res.reload()

// Fill the fields from the loaded task, but leave a field alone if the user already started editing it.
watch(
	task,
	(t, old) => {
		if (!t) return
		if (!old || assignee.value === (old.assignee ?? '')) assignee.value = t.assignee ?? ''
		if (!old || priority.value === (old.priority ?? 0)) priority.value = t.priority ?? 0
	},
	{ immediate: true },
)

const moveOptions = computed(() => (task.value ? targets(task.value.status) : []))
const html = computed(() => (task.value?.body ? renderMarkdown(task.value.body) : ''))
const resultHtml = computed(() => {
	const t = task.value
	const text = t?.latest_summary || t?.result
	return text ? renderMarkdown(text) : ''
})

async function patch(body: Record<string, unknown>, done: string) {
	busy.value = true
	const prev = res.data.value
	res.mutate((d) => (d ? { ...d, task: { ...d.task, ...body } } : d))
	try {
		await dashboard.updateTask(props.id, body, props.board)
		toasts.push(done)
		emit('changed')
		await load()
	} catch (e) {
		res.mutate(() => prev)
		toasts.error((e as Error).message)
		await load()
	} finally {
		busy.value = false
	}
}

async function move(e: Event) {
	const to = (e.target as HTMLSelectElement).value
	if (!to) return
	;(e.target as HTMLSelectElement).value = ''
	await patch({ status: to }, `Moved to ${label(to)}`)
}

const saveAssignee = () =>
	assignee.value !== (task.value?.assignee ?? '') && patch({ assignee: assignee.value.trim() }, 'Assignee saved')
const savePriority = () =>
	Number(priority.value) !== task.value?.priority && patch({ priority: Number(priority.value) || 0 }, 'Priority saved')

async function addComment() {
	if (!comment.value.trim()) return
	busy.value = true
	try {
		await dashboard.commentTask(props.id, comment.value.trim(), props.board)
		comment.value = ''
		toasts.push('Comment added')
		emit('changed')
		await load()
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}

async function remove() {
	const ok = await dialogs.confirm({
		title: `Delete “${task.value?.title}”?`,
		body: 'The task is removed from the board and cannot be restored.',
		action: 'Delete task',
		danger: true,
	})
	if (!ok) return
	try {
		await dashboard.deleteTask(props.id, props.board)
		toasts.push('Task deleted')
		emit('changed')
		emit('close')
	} catch (e) {
		toasts.error((e as Error).message)
	}
}

function eventText(ev: any) {
	const p = ev.payload ?? {}
	switch (ev.kind) {
		case 'status':
			return `Moved to ${label(p.status)}`
		case 'commented':
			return `${p.author ?? 'Someone'} commented`
		case 'created':
			return 'Created'
		case 'assigned':
			return `Assigned to ${p.assignee ?? 'nobody'}`
		default:
			return String(ev.kind)
				.replace(/_/g, ' ')
				.replace(/^./, (c) => c.toUpperCase())
	}
}
</script>

<template>
	<Modal :title="task?.title ?? initial?.title ?? 'Task'" wide @close="emit('close')">
		<p v-if="loadError" class="text-rose">Could not load this task: {{ loadError }}</p>
		<Skeleton v-else-if="!task" variant="lines" :count="6" label="Loading task" />
		<div v-else class="space-y-6">
			<div class="grid gap-4 sm:grid-cols-3">
				<div>
					<label class="label" for="td-move">Move to</label>
					<select id="td-move" class="field" :disabled="busy || !moveOptions.length" @change="move">
						<option value="">{{ label(task.status) }} (current)</option>
						<option v-for="s in moveOptions" :key="s" :value="s">{{ label(s) }}</option>
					</select>
				</div>
				<div>
					<label class="label" for="td-assignee">Assignee</label>
					<input
						id="td-assignee"
						v-model="assignee"
						class="field"
						list="td-assignees"
						placeholder="Unassigned"
						@change="saveAssignee"
					/>
					<datalist id="td-assignees"><option v-for="a in assignees" :key="a" :value="a" /></datalist>
				</div>
				<div>
					<label class="label" for="td-priority">Priority</label>
					<input
						id="td-priority"
						v-model.number="priority"
						class="field"
						type="number"
						step="1"
						@change="savePriority"
					/>
				</div>
			</div>

			<RouterLink v-if="task.session_id" :to="`/chat/${task.session_id}`" class="btn-outline inline-flex"
				>Open the agent's chat</RouterLink
			>

			<p v-if="task.last_failure_error" class="rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
				Last run failed: {{ task.last_failure_error }}
			</p>

			<section v-if="html">
				<h3 class="mb-1 text-base font-semibold">Details</h3>
				<div class="prose-h max-w-[72ch]" v-html="html" />
			</section>

			<section v-if="resultHtml">
				<h3 class="mb-1 text-base font-semibold">Result</h3>
				<div class="prose-h max-w-[72ch]" v-html="resultHtml" />
			</section>

			<section>
				<h3 class="mb-2 text-base font-semibold">Comments</h3>
				<ul v-if="comments.length" class="divide-y divide-line">
					<li v-for="c in comments" :key="c.id" class="py-2">
						<div class="text-xs text-ink-3">
							<span class="text-ink-2">{{ c.author }}</span> {{ relative(c.created_at) }}
						</div>
						<div class="prose-h max-w-[72ch]" v-html="renderMarkdown(c.body)" />
					</li>
				</ul>
				<p v-else class="text-sm text-ink-3">No comments yet.</p>
				<form class="mt-3 space-y-2" @submit.prevent="addComment">
					<label class="label" for="td-comment">Add a comment</label>
					<textarea id="td-comment" v-model="comment" class="field" rows="2" />
					<button class="btn-outline" type="submit" :disabled="busy || !comment.trim()">Add comment</button>
				</form>
			</section>

			<section v-if="runs.length">
				<h3 class="mb-2 text-base font-semibold">Runs</h3>
				<ul class="divide-y divide-line text-sm">
					<li v-for="r in runs" :key="r.id" class="py-2">
						<div class="flex flex-wrap items-baseline gap-x-3">
							<span :class="r.status === 'running' ? 'text-gold' : r.error ? 'text-rose' : ''">{{
								r.outcome ?? r.status
							}}</span>
							<span v-if="r.profile" class="text-ink-2">{{ r.profile }}</span>
							<span class="text-ink-3">{{ dateTime(r.started_at) }}</span>
						</div>
						<p v-if="r.summary" class="text-ink-2">{{ r.summary }}</p>
						<p v-if="r.error" class="text-rose">{{ r.error }}</p>
					</li>
				</ul>
			</section>

			<section v-if="events.length">
				<h3 class="mb-2 text-base font-semibold">History</h3>
				<ul class="space-y-1 text-sm">
					<li v-for="ev in events" :key="ev.id" class="flex gap-3">
						<span class="w-40 shrink-0 text-ink-3">{{ dateTime(ev.created_at) }}</span>
						<span class="text-ink-2">{{ eventText(ev) }}</span>
					</li>
				</ul>
			</section>
		</div>
		<template #footer>
			<button class="btn-danger mr-auto" :disabled="!task" @click="remove">Delete task</button>
			<button class="btn-outline" @click="emit('close')">Close</button>
		</template>
	</Modal>
</template>
