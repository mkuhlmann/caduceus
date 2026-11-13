<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import BoardColumn from '@/components/board/BoardColumn.vue'
import TaskDetail from '@/components/board/TaskDetail.vue'
import NewTaskModal from '@/components/board/NewTaskModal.vue'
import NewBoardModal from '@/components/board/NewBoardModal.vue'
import { COLUMNS, canDrop, label } from '@/components/board/columns'
import { dashboard, type KanbanTask } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'

type Col = { name: string; tasks: KanbanTask[] }
type BoardData = Awaited<ReturnType<typeof dashboard.board>>

const app = useApp()
const toasts = useToasts()

const connected = computed(() => !!app.dashboard?.ok)
/** The board the user picked; undefined means the dashboard's current board, so the first load needs no extra round trip. */
const picked = ref<string | undefined>()
const openTask = ref<KanbanTask | null>(null)
const showNewTask = ref(false)
const showNewBoard = ref(false)
const mobileCol = ref('ready')
// The card being dragged. Plain on purpose: pointer moves read it, and nothing on screen renders from it.
let drag: { id: string; from: string } | null = null
/** Reactive twin of `drag`, for holding back refreshes until the drop. */
const dragging = ref(false)

const boardsRes = useResource(
	() => (connected.value ? 'kanban:boards' : null),
	() => dashboard.boards(),
)
const boards = computed(() => (boardsRes.data.value?.boards ?? []).filter((b) => !(b as any).archived))
const board = computed({
	get: () => picked.value ?? boardsRes.data.value?.current,
	set: (b) => (picked.value = b),
})

// The current board is cached under '' whether it was picked or not, so picking it again is instant.
const boardKey = computed(() => (picked.value && picked.value !== boardsRes.data.value?.current ? picked.value : ''))
const boardRes = useResource<BoardData>(
	() => (connected.value ? `kanban:board:${boardKey.value}` : null),
	() => dashboard.board(boardKey.value || undefined),
)
const assignees = computed(() => [...new Set(boardRes.data.value?.assignees ?? [])])
const error = computed(() => (boardRes.data.value ? '' : boardRes.error.value || boardsRes.error.value))
const pending = computed(() => boardRes.pending.value || (!boardRes.data.value && boardsRes.pending.value))

// What the board shows. A refresh that lands mid-drag waits until the drag ends, so the card under the pointer
// never jumps or re-renders while it is being dragged.
const columns = shallowRef<Col[]>([])
// A poll usually brings the same tasks: keep unchanged columns as they were, so only changed columns re-render.
const sig = new WeakMap<Col, string>()
const signature = (c: Col) => {
	let s = sig.get(c)
	if (s === undefined) sig.set(c, (s = JSON.stringify(c.tasks)))
	return s
}
function pick(d?: BoardData): Col[] {
	const prev = new Map(columns.value.map((c) => [c.name, c]))
	return (d?.columns ?? [])
		.filter((c) => c.name in COLUMNS)
		.map((c) => {
			const old = prev.get(c.name)
			return old && old !== c && signature(old) === signature(c) ? old : c
		})
}
watch(
	[() => boardRes.data.value, dragging],
	([d, held]) => {
		if (!held) columns.value = pick(d)
	},
	{ immediate: true },
)
const total = computed(() => columns.value.reduce((n, c) => n + c.tasks.length, 0))

const loadBoard = () => boardRes.reload()
function retry() {
	boardsRes.reload()
	boardRes.reload()
}

async function moveTask(id: string, from: string, to: string) {
	if (from === to) return
	if (!canDrop(from, to)) {
		toasts.error(`Tasks can't be moved into ${label(to)} by hand.`)
		return
	}
	const prev = boardRes.data.value
	const task = prev?.columns.find((c) => c.name === from)?.tasks.find((t) => t.id === id)
	if (!prev || !task) return
	boardRes.mutate((d) =>
		d
			? {
					...d,
					columns: d.columns.map((c) =>
						c.name === from
							? { ...c, tasks: c.tasks.filter((t) => t.id !== id) }
							: c.name === to
								? { ...c, tasks: [{ ...task, status: to }, ...c.tasks] }
								: c,
					),
				}
			: d,
	)
	try {
		await dashboard.updateTask(id, { status: to }, board.value)
		toasts.push(`Moved to ${label(to)}`)
	} catch (e) {
		boardRes.mutate(() => prev)
		toasts.error((e as Error).message)
	} finally {
		loadBoard()
	}
}

const accepts = (to: string) => !!drag && canDrop(drag.from, to)
function onDragStart(t: KanbanTask) {
	drag = { id: t.id, from: t.status }
	dragging.value = true
}
function onDragEnd() {
	drag = null
	dragging.value = false
}
function onDrop(to: string) {
	const d = drag
	if (d) moveTask(d.id, d.from, to)
	onDragEnd()
}

const openDetail = (t: KanbanTask) => (openTask.value = t)

function onCreated(t: KanbanTask) {
	showNewTask.value = false
	mobileCol.value = t.status
	loadBoard()
}

function onBoardCreated(slug: string) {
	showNewBoard.value = false
	picked.value = slug
	boardsRes.reload()
}

let timer: ReturnType<typeof setInterval> | undefined
function tick() {
	if (document.visibilityState !== 'visible' || !connected.value || drag) return
	if (!boardRes.pending.value && !boardRes.refreshing.value) loadBoard()
}
function onVisible() {
	if (document.visibilityState === 'visible') tick()
}

onMounted(() => {
	timer = setInterval(tick, 10_000)
	document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
	clearInterval(timer)
	document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
	<div class="flex h-full flex-col overflow-hidden">
		<PageHeader title="Board" subtitle="Tasks for Hermes and its agents, from rough idea to done.">
			<template v-if="connected">
				<label v-if="boards.length > 1" class="sr-only" for="board-switch">Board</label>
				<select v-if="boards.length > 1" id="board-switch" v-model="board" class="field w-auto">
					<option v-for="b in boards" :key="b.slug" :value="b.slug">{{ b.name || b.slug }}</option>
				</select>
				<button class="btn-outline" @click="showNewBoard = true">New board</button>
				<button class="btn-primary" @click="showNewTask = true"><Plus :size="16" />New task</button>
			</template>
		</PageHeader>

		<EmptyState
			v-if="!connected"
			title="Connect the dashboard to see the board"
			body="The board lives in the Hermes dashboard. Add its address on the connection page."
		>
			<RouterLink to="/settings/connection" class="btn-primary">Open connection settings</RouterLink>
		</EmptyState>

		<template v-else>
			<p v-if="error" class="mx-6 mb-3 rounded-md bg-rose-soft px-3 py-2 text-sm text-rose md:mx-10">
				Could not load the board: {{ error }}
				<button class="underline" @click="retry">Try again</button>
			</p>

			<template v-else>
				<p v-if="!pending && !total" class="px-6 pb-3 text-ink-2 md:px-10">
					Nothing on this board yet. Create a task, or put a rough idea in triage and let Hermes specify it.
				</p>

				<!-- Mobile: one column at a time. Shown while loading too, so the columns do not jump down. -->
				<div class="px-6 pb-3 md:hidden">
					<label class="label" for="col-pick">Column</label>
					<select id="col-pick" v-model="mobileCol" class="field" :disabled="pending">
						<option v-for="c in pending ? Object.keys(COLUMNS) : columns.map((c) => c.name)" :key="c" :value="c">
							{{ label(c) }}{{ pending ? '' : ` (${columns.find((x) => x.name === c)?.tasks.length ?? 0})` }}
						</option>
					</select>
				</div>

				<Skeleton v-if="pending" variant="cards" :count="8" label="Loading board" class="px-6 md:px-10" />

				<div v-else class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-8 md:px-10">
					<BoardColumn
						v-for="c in columns"
						:key="c.name"
						:name="c.name"
						:tasks="c.tasks"
						:active="c.name === mobileCol"
						:accepts="accepts"
						@dragstart="onDragStart"
						@dragend="onDragEnd"
						@drop="onDrop"
						@open="openDetail"
					/>
				</div>
			</template>
		</template>

		<TaskDetail
			v-if="openTask"
			:id="openTask.id"
			:initial="openTask"
			:board="board"
			:assignees="assignees"
			@close="openTask = null"
			@changed="loadBoard"
		/>
		<NewTaskModal
			v-if="showNewTask"
			:board="board"
			:assignees="assignees"
			@close="showNewTask = false"
			@created="onCreated"
		/>
		<NewBoardModal v-if="showNewBoard" @close="showNewBoard = false" @created="onBoardCreated" />
	</div>
</template>
