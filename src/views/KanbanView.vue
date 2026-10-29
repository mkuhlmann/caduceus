<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import TaskCard from '@/components/board/TaskCard.vue'
import TaskDetail from '@/components/board/TaskDetail.vue'
import NewTaskModal from '@/components/board/NewTaskModal.vue'
import NewBoardModal from '@/components/board/NewBoardModal.vue'
import { COLUMNS, canDrop, label } from '@/components/board/columns'
import { dashboard, type KanbanBoard, type KanbanTask } from '@/lib/dashboard'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'

type Col = { name: string; tasks: KanbanTask[] }

const app = useApp()
const toasts = useToasts()

const boards = ref<KanbanBoard[]>([])
const board = ref<string | undefined>()
const columns = ref<Col[]>([])
const assignees = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const openId = ref<string | null>(null)
const showNewTask = ref(false)
const showNewBoard = ref(false)
const mobileCol = ref('ready')
const dragging = ref<{ id: string; from: string } | null>(null)
const dropOver = ref<string | null>(null)

const connected = computed(() => !!app.dashboard?.ok)
const total = computed(() => columns.value.reduce((n, c) => n + c.tasks.length, 0))

async function loadBoard(quiet = false) {
	if (!quiet) loading.value = true
	try {
		const r = await dashboard.board(board.value)
		// Do not clobber an in-flight drag with a poll result.
		if (!dragging.value) columns.value = r.columns.filter((c) => c.name in COLUMNS)
		const names = new Set(r.assignees ?? [])
		assignees.value = [...names]
		error.value = ''
	} catch (e) {
		if (!quiet || !columns.value.length) error.value = (e as Error).message
	} finally {
		loading.value = false
	}
}

async function init() {
	loading.value = true
	try {
		const r = await dashboard.boards()
		boards.value = r.boards.filter((b) => !(b as any).archived)
		board.value = board.value && boards.value.some((b) => b.slug === board.value) ? board.value : r.current
		await loadBoard()
	} catch (e) {
		error.value = (e as Error).message
		loading.value = false
	}
}

watch(board, (b, old) => old !== undefined && loadBoard())

async function moveTask(id: string, from: string, to: string) {
	if (from === to) return
	if (!canDrop(from, to)) {
		toasts.error(`Tasks can't be moved into ${label(to)} by hand.`)
		return
	}
	const prev = columns.value
	const src = prev.find((c) => c.name === from)
	const task = src?.tasks.find((t) => t.id === id)
	if (!task) return
	columns.value = prev.map((c) =>
		c.name === from
			? { ...c, tasks: c.tasks.filter((t) => t.id !== id) }
			: c.name === to
				? { ...c, tasks: [{ ...task, status: to }, ...c.tasks] }
				: c,
	)
	try {
		await dashboard.updateTask(id, { status: to }, board.value)
		toasts.push(`Moved to ${label(to)}`)
	} catch (e) {
		columns.value = prev
		toasts.error((e as Error).message)
	} finally {
		loadBoard(true)
	}
}

function onDragStart(ev: DragEvent, t: KanbanTask) {
	dragging.value = { id: t.id, from: t.status }
	ev.dataTransfer?.setData('text/plain', t.id)
	if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() {
	dragging.value = null
	dropOver.value = null
}
function onDragOver(ev: DragEvent, col: string) {
	const d = dragging.value
	if (!d || !canDrop(d.from, col)) return
	ev.preventDefault()
	dropOver.value = col
}
function onDrop(ev: DragEvent, col: string) {
	ev.preventDefault()
	const d = dragging.value
	dragging.value = null
	dropOver.value = null
	if (d) moveTask(d.id, d.from, col)
}

function onCreated(t: KanbanTask) {
	showNewTask.value = false
	mobileCol.value = t.status
	loadBoard(true)
}

let timer: ReturnType<typeof setInterval> | undefined
function tick() {
	if (document.visibilityState === 'visible' && connected.value && !loading.value && !dragging.value) loadBoard(true)
}
function onVisible() {
	if (document.visibilityState === 'visible') tick()
}

onMounted(() => {
	if (connected.value) init()
	timer = setInterval(tick, 10_000)
	document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
	clearInterval(timer)
	document.removeEventListener('visibilitychange', onVisible)
})
watch(connected, (c) => c && init())
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
			<RouterLink to="/connect" class="btn-primary">Open connection settings</RouterLink>
		</EmptyState>

		<template v-else>
			<p v-if="error" class="mx-6 mb-3 rounded-md bg-rose-soft px-3 py-2 text-sm text-rose md:mx-10">
				Could not load the board: {{ error }}
				<button class="underline" @click="init">Try again</button>
			</p>
			<p v-else-if="loading" class="px-6 text-ink-3 md:px-10">Loading board</p>

			<template v-else>
				<p v-if="!total" class="px-6 pb-3 text-ink-2 md:px-10">
					Nothing on this board yet. Create a task, or put a rough idea in triage and let Hermes specify it.
				</p>

				<!-- Mobile: one column at a time -->
				<div class="px-6 pb-3 md:hidden">
					<label class="label" for="col-pick">Column</label>
					<select id="col-pick" v-model="mobileCol" class="field">
						<option v-for="c in columns" :key="c.name" :value="c.name">
							{{ label(c.name) }} ({{ c.tasks.length }})
						</option>
					</select>
				</div>

				<div class="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-8 md:px-10">
					<section
						v-for="c in columns"
						:key="c.name"
						class="min-h-0 w-full shrink-0 flex-col rounded-lg border bg-surface-2/50 md:w-72"
						:class="[
							c.name === mobileCol ? 'flex' : 'hidden md:flex',
							dropOver === c.name ? 'border-ink-3' : 'border-line',
						]"
						:aria-label="label(c.name)"
						@dragover="onDragOver($event, c.name)"
						@dragleave="dropOver === c.name && (dropOver = null)"
						@drop="onDrop($event, c.name)"
					>
						<header class="flex items-baseline justify-between px-3 pt-3 pb-2" :title="COLUMNS[c.name]?.hint">
							<h2 class="flex items-center gap-2 text-sm font-semibold">
								<span v-if="c.name === 'running' && c.tasks.length" class="size-2 rounded-full bg-gold" />
								{{ label(c.name) }}
							</h2>
							<span class="text-xs text-ink-3">{{ c.tasks.length }}</span>
						</header>
						<p class="hidden px-3 pb-2 text-xs text-ink-3 md:block">{{ COLUMNS[c.name]?.hint }}</p>
						<div class="min-h-24 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
							<div v-for="t in c.tasks" :key="t.id" @dragstart="onDragStart($event, t)" @dragend="onDragEnd">
								<TaskCard :task="t" @open="openId = t.id" />
							</div>
							<p v-if="!c.tasks.length" class="px-1 py-4 text-sm text-ink-3">No tasks</p>
						</div>
					</section>
				</div>
			</template>
		</template>

		<TaskDetail
			v-if="openId"
			:id="openId"
			:board="board"
			:assignees="assignees"
			@close="openId = null"
			@changed="loadBoard(true)"
		/>
		<NewTaskModal
			v-if="showNewTask"
			:board="board"
			:assignees="assignees"
			@close="showNewTask = false"
			@created="onCreated"
		/>
		<NewBoardModal
			v-if="showNewBoard"
			@close="showNewBoard = false"
			@created="
				(s) => {
					showNewBoard = false
					board = s
					init()
				}
			"
		/>
	</div>
</template>
