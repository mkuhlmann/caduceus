<script setup lang="ts">
/**
 * One board column. Drag state lives here rather than in the board, so a drag only re-renders the column
 * under the pointer and the one the card came from, never the whole board.
 */
import { ref } from 'vue'
import TaskCard from './TaskCard.vue'
import { COLUMNS, label } from './columns'
import type { KanbanTask } from '@/lib/dashboard'

const props = defineProps<{
	name: string
	tasks: KanbanTask[]
	/** Shown on phones, where the board shows one column at a time. */
	active: boolean
	/** Whether the card being dragged may be dropped here. Read in event handlers only, so it never causes a render. */
	accepts: (to: string) => boolean
}>()
const emit = defineEmits<{ dragstart: [task: KanbanTask]; dragend: []; drop: [to: string]; open: [task: KanbanTask] }>()

const over = ref(false)
const draggingId = ref<string | null>(null)

function onDragStart(ev: DragEvent, t: KanbanTask) {
	draggingId.value = t.id
	ev.dataTransfer?.setData('text/plain', t.id)
	if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
	emit('dragstart', t)
}
function onDragEnd() {
	draggingId.value = null
	emit('dragend')
}
// dragover fires on every pointer move: it writes `over` only when it changes.
function onDragOver(ev: DragEvent) {
	if (!props.accepts(props.name)) return
	ev.preventDefault()
	if (!over.value) over.value = true
}
function onDragLeave(ev: DragEvent) {
	// Moving over a card inside the column is not leaving it.
	if ((ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node | null)) return
	over.value = false
}
function onDrop(ev: DragEvent) {
	ev.preventDefault()
	over.value = false
	emit('drop', props.name)
}
</script>

<template>
	<section
		class="min-h-0 w-full shrink-0 flex-col rounded-lg border bg-surface-2/50 md:w-72"
		:class="[active ? 'flex' : 'hidden md:flex', over ? 'border-ink-3' : 'border-line']"
		:aria-label="label(name)"
		@dragover="onDragOver"
		@dragleave="onDragLeave"
		@drop="onDrop"
	>
		<header class="flex items-baseline justify-between px-3 pt-3 pb-2" :title="COLUMNS[name]?.hint">
			<h2 class="flex items-center gap-2 text-sm font-semibold">
				<span v-if="name === 'running' && tasks.length" class="size-2 rounded-full bg-gold" />
				{{ label(name) }}
			</h2>
			<span class="text-xs text-ink-3">{{ tasks.length }}</span>
		</header>
		<p class="hidden px-3 pb-2 text-xs text-ink-3 md:block">{{ COLUMNS[name]?.hint }}</p>
		<!-- A moved card leaves its old column at once (the rest close up) and rises into the new one. -->
		<TransitionGroup
			name="rise"
			tag="div"
			leave-active-class="hidden"
			class="relative min-h-24 flex-1 space-y-2 overflow-y-auto px-2 pb-2"
		>
			<div
				v-for="t in tasks"
				:key="t.id"
				:class="draggingId === t.id && 'opacity-40'"
				@dragstart="onDragStart($event, t)"
				@dragend="onDragEnd"
			>
				<TaskCard :task="t" @open="emit('open', t)" />
			</div>
			<p v-if="!tasks.length" key="empty" class="px-1 py-4 text-sm text-ink-3">No tasks</p>
		</TransitionGroup>
	</section>
</template>
