<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Play, Pause, Pencil, Trash2 } from 'lucide-vue-next'
import type { Job } from '@/lib/gateway'
import { dashboard } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { useApp } from '@/stores/app'
import { relative, dateTime } from '@/lib/time'

const props = defineProps<{ job: Job; finished?: boolean; busy?: boolean }>()
defineEmits<{ run: []; toggle: []; edit: []; remove: [] }>()

const app = useApp()
const open = ref(false)
const errorOpen = ref(false)
// Runs load when the row first opens and stay cached, so reopening it shows them at once.
const {
	data: runs,
	error: runsError,
	pending: runsPending,
} = useResource<any[]>(
	() => (open.value && app.dashboard?.ok ? `schedule-runs:${props.job.id}` : null),
	() => dashboard.jobRuns(props.job.id),
)

const paused = computed(() => props.job.state === 'paused' || props.job.enabled === false)
const running = computed(() => props.job.state === 'running')
const schedule = computed(
	() =>
		props.job.schedule_display ||
		(typeof props.job.schedule === 'string' ? props.job.schedule : props.job.schedule?.display) ||
		'',
)
const repeatText = computed(() => {
	const r = props.job.repeat
	if (!r || typeof r !== 'object') return ''
	if (r.times) return `${r.completed ?? 0} of ${r.times} runs done`
	return r.completed ? `${r.completed} runs so far` : ''
})

function toggle() {
	open.value = !open.value
}

// A script-only job runs without the agent, so its runs are output files on the Hermes host, not chats.
// Hermes lists them with `source: 'cron_output'` and serves only the first 180 characters of each.
const isOutputRun = (r: any) => r.source === 'cron_output'
const openRun = ref<string | null>(null)
function outputRun(r: any) {
	// The title carries the run's outcome in front ("COMPLETED · …"); the preview, the file's own text.
	const m = /^([A-Z][A-Z ]*) · /.exec(r.title ?? '')
	const status = m ? m[1]!.charAt(0) + m[1]!.slice(1).toLowerCase() : ''
	// The file opens with a header naming the job, run time and mode; the script's output follows `---`.
	let text = String(r.preview ?? '')
	if (text.startsWith('# Cron Job:')) text = text.slice(text.indexOf('---') + 3).trim()
	return { status, text }
}
</script>

<template>
	<li>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2.5 sm:flex-nowrap">
			<button
				class="pressable flex min-w-0 flex-1 basis-60 items-center gap-2 text-left"
				:aria-expanded="open"
				@click="toggle"
			>
				<ChevronRight :size="16" class="shrink-0 text-ink-3 transition-transform" :class="open && 'rotate-90'" />
				<span class="min-w-0">
					<span class="block truncate font-medium" :title="job.name">{{ job.name }}</span>
					<span class="block truncate text-sm text-ink-2" :title="schedule">{{ schedule }}</span>
				</span>
			</button>

			<div class="w-40 shrink-0 pl-6 text-sm sm:pl-0">
				<template v-if="running"><span class="text-gold">Running now</span></template>
				<template v-else-if="finished || paused">
					<span class="text-ink-3">{{ finished ? 'Finished' : 'Paused' }}</span>
				</template>
				<template v-else-if="job.next_run_at">
					<span :title="dateTime(job.next_run_at)">Next {{ relative(job.next_run_at) }}</span>
				</template>
			</div>

			<div class="w-32 shrink-0 text-sm">
				<template v-if="job.last_status === 'ok'">
					<span class="text-verdigris" :title="dateTime(job.last_run_at)">Ran {{ relative(job.last_run_at) }}</span>
				</template>
				<template v-else-if="job.last_status === 'error'">
					<button
						class="pressable text-rose underline decoration-dotted underline-offset-2"
						:aria-expanded="errorOpen"
						@click="errorOpen = !errorOpen"
					>
						Failed {{ relative(job.last_run_at) }}
					</button>
				</template>
				<span v-else class="text-ink-3">Not run yet</span>
			</div>

			<div class="ml-auto flex shrink-0 items-center">
				<button class="icon-btn" :disabled="busy" title="Run now" aria-label="Run now" @click="$emit('run')">
					<Play :size="16" />
				</button>
				<button
					v-if="!finished"
					class="icon-btn"
					:disabled="busy"
					:title="paused ? 'Resume schedule' : 'Pause schedule'"
					:aria-label="paused ? 'Resume schedule' : 'Pause schedule'"
					@click="$emit('toggle')"
				>
					<Play v-if="paused" :size="16" class="fill-current" /><Pause v-else :size="16" />
				</button>
				<button
					class="icon-btn"
					:disabled="busy"
					title="Edit schedule"
					aria-label="Edit schedule"
					@click="$emit('edit')"
				>
					<Pencil :size="16" />
				</button>
				<button
					class="icon-btn hover:text-rose"
					:disabled="busy"
					title="Delete schedule"
					aria-label="Delete schedule"
					@click="$emit('remove')"
				>
					<Trash2 :size="16" />
				</button>
			</div>
		</div>

		<Transition enter-active-class="rise-enter-active" enter-from-class="rise-enter-from">
			<p
				v-if="errorOpen && job.last_error"
				class="mx-2 mb-2 ml-8 max-w-[72ch] whitespace-pre-wrap break-words rounded-md bg-rose-soft px-3 py-2 text-sm text-rose"
			>
				{{ job.last_error }}
			</p>
		</Transition>

		<!-- Opening fades and lifts the details in; closing is instant so the rows below never wait. -->
		<Transition enter-active-class="rise-enter-active" enter-from-class="rise-enter-from">
			<div v-if="open" class="mb-3 ml-8 mr-2 max-w-[72ch] space-y-3">
				<p v-if="paused && job.paused_reason" class="text-sm text-ink-2">Paused: {{ job.paused_reason }}</p>
				<p v-if="job.no_agent && job.script" class="text-sm">
					Runs the script <span class="font-mono">{{ job.script }}</span> on the Hermes host, without the agent.
				</p>
				<p v-if="job.prompt" class="whitespace-pre-wrap break-words text-sm">{{ job.prompt }}</p>
				<p class="text-sm text-ink-3">
					Sends to {{ job.deliver || 'local'
					}}<template v-if="job.skills?.length"> with skills {{ job.skills.join(', ') }}</template
					><template v-if="repeatText">. {{ repeatText }}</template
					><template v-if="job.next_run_at">. Next run {{ dateTime(job.next_run_at) }}</template>
				</p>
				<div v-if="app.dashboard?.ok">
					<h3 class="mb-1 text-sm font-semibold">Recent runs</h3>
					<ul
						v-if="runsPending"
						class="skeleton divide-y divide-line rounded-md border border-line"
						role="status"
						aria-label="Loading runs"
					>
						<li v-for="i in 3" :key="i" class="flex h-8 items-center px-3">
							<span class="skeleton-bar h-3" :style="{ width: `${[52, 40, 46][i - 1]}%` }" />
						</li>
					</ul>
					<p v-else-if="runsError && !runs" class="text-sm text-rose">Could not load runs: {{ runsError }}</p>
					<p v-else-if="!runs?.length" class="text-sm text-ink-3">No runs yet.</p>
					<ul v-else class="divide-y divide-line rounded-md border border-line">
						<li v-for="r in runs" :key="r.id">
							<template v-if="isOutputRun(r)">
								<button
									class="pressable flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
									:aria-expanded="openRun === r.id"
									@click="openRun = openRun === r.id ? null : r.id"
								>
									<span class="flex min-w-0 items-center gap-2">
										<ChevronRight
											:size="16"
											class="shrink-0 text-ink-3 transition-transform"
											:class="openRun === r.id && 'rotate-90'"
										/>
										<span class="truncate">{{ dateTime(r.started_at) }}</span>
									</span>
									<span
										class="shrink-0"
										:class="/fail|error/i.test(outputRun(r).status) ? 'text-rose' : 'text-ink-3'"
										>{{ outputRun(r).status || 'Script output' }}</span
									>
								</button>
								<div v-if="openRun === r.id" class="space-y-1 px-3 pb-2 pl-9">
									<p
										v-if="outputRun(r).text"
										class="whitespace-pre-wrap break-words font-mono text-xs text-ink-2"
										v-text="outputRun(r).text"
									/>
									<p class="text-xs text-ink-3">
										{{ outputRun(r).text ? 'Only the start of the output is shown.' : 'This run left no output.' }}
										The script ran without the agent, so there is no chat to open. Hermes keeps the full output on its
										host under <span class="font-mono">cron/output/{{ job.id }}/</span>.
									</p>
								</div>
							</template>
							<router-link
								v-else
								:to="`/chat/${encodeURIComponent(r.id)}`"
								class="pressable flex items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-surface-2"
							>
								<span class="truncate">{{ r.title || dateTime(r.started_at) }}</span>
								<span class="shrink-0 text-ink-3"
									>{{ r.title ? dateTime(r.started_at) : ''
									}}<template v-if="r.message_count"> ({{ r.message_count }} messages)</template></span
								>
							</router-link>
						</li>
					</ul>
				</div>
			</div>
		</Transition>
	</li>
</template>
