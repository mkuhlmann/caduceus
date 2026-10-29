<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Search } from 'lucide-vue-next'
import { gateway, type Job } from '@/lib/gateway'
import { useToasts } from '@/stores/toast'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ScheduleRow from '@/components/schedules/ScheduleRow.vue'
import ScheduleForm from '@/components/schedules/ScheduleForm.vue'

const toasts = useToasts()
const jobs = ref<Job[] | null>(null)
const error = ref('')
const query = ref('')
const busyId = ref('')
const editing = ref<Job | null>(null)
const creating = ref(false)

async function load() {
	try {
		jobs.value = await gateway.jobs()
		error.value = ''
	} catch (e) {
		error.value = (e as Error).message
		jobs.value ??= []
	}
}
onMounted(load)

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

async function act(job: Job, fn: () => Promise<unknown>, done: string) {
	busyId.value = job.id
	try {
		await fn()
		toasts.push(done)
		await load()
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busyId.value = ''
	}
}
const run = (j: Job) => act(j, () => gateway.runJob(j.id), 'Schedule started')
const toggle = (j: Job) =>
	isPaused(j)
		? act(j, () => gateway.resumeJob(j.id), 'Schedule resumed')
		: act(j, () => gateway.pauseJob(j.id), 'Schedule paused')
function remove(j: Job) {
	if (confirm(`Delete the schedule "${j.name}"? This cannot be undone.`))
		act(j, () => gateway.deleteJob(j.id), 'Schedule deleted')
}
async function saved() {
	editing.value = null
	creating.value = false
	await load()
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader title="Schedules" subtitle="Tasks Hermes runs on its own, on a timer or at a set time.">
			<button class="btn-primary" @click="creating = true"><Plus :size="16" />New schedule</button>
		</PageHeader>

		<div class="px-6 pb-16 md:px-10">
			<p v-if="error" class="mb-4 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
				Could not load schedules: {{ error }}. Check the gateway connection.
			</p>
			<p v-if="jobs === null" class="text-ink-3">Loading schedules</p>

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
					<ul class="divide-y divide-line border-y border-line">
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
					</ul>
				</section>
			</template>
		</div>

		<ScheduleForm v-if="creating" @close="creating = false" @saved="saved" />
		<ScheduleForm v-if="editing" :job="editing" @close="editing = null" @saved="saved" />
	</div>
</template>
