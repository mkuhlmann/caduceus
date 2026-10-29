<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Play, Pause, Pencil, Trash2 } from 'lucide-vue-next'
import type { Job } from '@/lib/gateway'
import { dashboard } from '@/lib/dashboard'
import { useApp } from '@/stores/app'
import { relative, dateTime } from '@/lib/time'

const props = defineProps<{ job: Job; finished?: boolean; busy?: boolean }>()
defineEmits<{ run: []; toggle: []; edit: []; remove: [] }>()

const app = useApp()
const open = ref(false)
const runs = ref<any[] | null>(null)
const runsError = ref('')
const errorOpen = ref(false)

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

async function toggle() {
	open.value = !open.value
	if (open.value && runs.value === null && app.dashboard?.ok) {
		try {
			runs.value = await dashboard.jobRuns(props.job.id)
		} catch (e) {
			runs.value = []
			runsError.value = (e as Error).message
		}
	}
}
</script>

<template>
	<li>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2.5 sm:flex-nowrap">
			<button class="flex min-w-0 flex-1 basis-60 items-center gap-2 text-left" :aria-expanded="open" @click="toggle">
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
						class="text-rose underline decoration-dotted underline-offset-2"
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

		<p
			v-if="errorOpen && job.last_error"
			class="mx-2 mb-2 ml-8 max-w-[72ch] whitespace-pre-wrap break-words rounded-md bg-rose-soft px-3 py-2 text-sm text-rose"
		>
			{{ job.last_error }}
		</p>

		<div v-if="open" class="mb-3 ml-8 mr-2 max-w-[72ch] space-y-3">
			<p v-if="paused && job.paused_reason" class="text-sm text-ink-2">Paused: {{ job.paused_reason }}</p>
			<p class="whitespace-pre-wrap break-words text-sm">{{ job.prompt }}</p>
			<p class="text-sm text-ink-3">
				Sends to {{ job.deliver || 'local'
				}}<template v-if="job.skills?.length"> with skills {{ job.skills.join(', ') }}</template
				><template v-if="repeatText">. {{ repeatText }}</template
				><template v-if="job.next_run_at">. Next run {{ dateTime(job.next_run_at) }}</template>
			</p>
			<div v-if="app.dashboard?.ok">
				<h3 class="mb-1 text-sm font-semibold">Recent runs</h3>
				<p v-if="runs === null" class="text-sm text-ink-3">Loading runs</p>
				<p v-else-if="runsError" class="text-sm text-rose">Could not load runs: {{ runsError }}</p>
				<p v-else-if="!runs.length" class="text-sm text-ink-3">No runs yet.</p>
				<ul v-else class="divide-y divide-line rounded-md border border-line">
					<li v-for="r in runs" :key="r.id">
						<router-link
							:to="`/chat/${encodeURIComponent(r.id)}`"
							class="flex items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-surface-2"
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
	</li>
</template>
