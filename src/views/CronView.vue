<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Plus, Search } from 'lucide-vue-next'
import { gateway, type Job } from '@/lib/gateway'
import { useResource } from '@/lib/resource'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import ScheduleRow from '@/components/schedules/ScheduleRow.vue'
import ScheduleForm from '@/components/schedules/ScheduleForm.vue'

const toasts = useToasts()
const dialogs = useDialogs()
// Cached per session: a revisit paints the last list at once and refreshes it in the background.
const {
	data: jobs,
	error,
	pending,
	refreshing,
	reload,
	mutate,
} = useResource('schedules', () => gateway.jobs(), {
	on: ['cron.changed'],
})
const query = ref('')
const busyId = ref('')
const editing = ref<Job | null>(null)
const creating = ref(false)

// Rows only animate in or out right after an action (pause, delete, ...), never on the first paint or a filter.
const animate = ref(false)
let animateTimer: ReturnType<typeof setTimeout> | undefined
function animateNext() {
	animate.value = true
	clearTimeout(animateTimer)
	animateTimer = setTimeout(() => (animate.value = false), 600)
}
onBeforeUnmount(() => clearTimeout(animateTimer))

const filtered = computed(() => {
	const q = query.value.trim().toLowerCase()
	const list = jobs.value ?? []
	return q ? list.filter((j) => `${j.name} ${j.prompt} ${j.schedule_display ?? ''}`.toLowerCase().includes(q)) : list
})
const isPaused = (j: Job) => j.state === 'paused' || j.enabled === false
const isDone = (j: Job) => j.state === 'completed' || (!j.next_run_at && !isPaused(j) && j.state !== 'running')
const byNext = (a: Job, b: Job) =>
	(a.next_run_at ?? '9').localeCompare(b.next_run_at ?? '9') || a.name.localeCompare(b.name)
const sections = computed(() => {
	const l = filtered.value
	return [
		{
			key: 'active',
			title: 'Active',
			finished: false,
			items: l
				.filter((j) => !isDone(j) && !isPaused(j))
				.sort((a, b) => new Date(a.next_run_at ?? 8e15).getTime() - new Date(b.next_run_at ?? 8e15).getTime()),
		},
		{ key: 'paused', title: 'Paused', finished: false, items: l.filter((j) => !isDone(j) && isPaused(j)).sort(byNext) },
		{
			key: 'done',
			title: 'Finished',
			finished: true,
			items: l.filter(isDone).sort((a, b) => a.name.localeCompare(b.name)),
		},
	].filter((s) => s.items.length)
})

/**
 * Runs an action on a schedule. `optimistic` changes the list at once (null removes the job);
 * the list reloads afterwards either way, which also undoes the change if the action failed.
 */
async function act(job: Job, fn: () => Promise<unknown>, done: string, optimistic?: Partial<Job> | null) {
	busyId.value = job.id
	animateNext()
	if (optimistic !== undefined)
		mutate((list) =>
			optimistic === null
				? list?.filter((j) => j.id !== job.id)
				: list?.map((j) => (j.id === job.id ? { ...j, ...optimistic } : j)),
		)
	try {
		await fn()
		toasts.push(done)
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busyId.value = ''
	}
	await reload()
}
const run = (j: Job) => act(j, () => gateway.runJob(j.id), 'Schedule started')
const toggle = (j: Job) =>
	isPaused(j)
		? act(
				j,
				() => gateway.resumeJob(j.id),
				'Schedule resumed',
				// Without a next run time a resumed job would look finished until the reload, so wait for it.
				j.next_run_at ? { state: 'scheduled', enabled: true, paused: false } : undefined,
			)
		: act(j, () => gateway.pauseJob(j.id), 'Schedule paused', { state: 'paused', enabled: false, paused: true })
async function remove(j: Job) {
	const ok = await dialogs.confirm({
		title: `Delete ${j.name}?`,
		body: 'The schedule stops and cannot be restored.',
		action: 'Delete schedule',
		danger: true,
	})
	if (ok) act(j, () => gateway.deleteJob(j.id), 'Schedule deleted', null)
}
async function saved() {
	editing.value = null
	creating.value = false
	animateNext()
	await reload()
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader title="Schedules" subtitle="Tasks Hermes runs on its own, on a timer or at a set time.">
			<button class="btn-primary" @click="creating = true"><Plus :size="16" />New schedule</button>
		</PageHeader>

		<div class="relative px-6 pb-16 md:px-10">
			<div v-if="refreshing" class="absolute inset-x-6 top-0 md:inset-x-10" aria-hidden="true">
				<div class="refresh-bar" />
			</div>
			<p v-if="error" class="mb-4 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
				Could not load schedules: {{ error }}. Check the gateway connection.
			</p>
			<div v-if="pending" class="mb-8">
				<div class="skeleton mb-1 flex h-7 items-center" aria-hidden="true">
					<span class="skeleton-bar h-4 w-20" />
				</div>
				<Skeleton :count="5" label="Loading schedules" />
			</div>

			<template v-else-if="!jobs" />

			<EmptyState
				v-else-if="!jobs.length && !error"
				title="No schedules yet"
				body="Ask Hermes to check something every morning, or remind you at a set time."
			>
				<button class="btn-primary" @click="creating = true"><Plus :size="16" />New schedule</button>
			</EmptyState>

			<template v-else-if="jobs.length">
				<div v-if="jobs.length > 8" class="relative mb-6 max-w-sm">
					<Search :size="16" class="pointer-events-none absolute left-2.5 top-2.5 text-ink-3" />
					<input
						v-model="query"
						class="field pl-8"
						type="search"
						placeholder="Filter schedules"
						aria-label="Filter schedules"
					/>
				</div>
				<p v-if="!filtered.length" class="text-ink-2">No schedule matches "{{ query }}".</p>
				<section v-for="s in sections" :key="s.key" class="mb-8">
					<h2 class="mb-1 text-lg">
						{{ s.title }} <span class="text-sm font-normal text-ink-3">{{ s.items.length }}</span>
					</h2>
					<TransitionGroup
						tag="ul"
						class="relative divide-y divide-line border-y border-line"
						:name="animate ? 'rise' : 'none'"
						:leave-active-class="animate ? 'rise-leave-active absolute inset-x-0' : undefined"
					>
						<ScheduleRow
							v-for="j in s.items"
							:key="j.id"
							:job="j"
							:finished="s.finished"
							:busy="busyId === j.id"
							@run="run(j)"
							@toggle="toggle(j)"
							@edit="editing = j"
							@remove="remove(j)"
						/>
					</TransitionGroup>
				</section>
			</template>
		</div>

		<ScheduleForm v-if="creating" @close="creating = false" @saved="saved" />
		<ScheduleForm v-if="editing" :job="editing" @close="editing = null" @saved="saved" />
	</div>
</template>
