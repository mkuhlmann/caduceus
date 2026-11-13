<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { gateway, type Job } from '@/lib/gateway'
import { dashboard } from '@/lib/dashboard'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import Modal from '@/components/Modal.vue'

const props = defineProps<{ job?: Job }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const app = useApp()
const toasts = useToasts()
const busy = ref(false)
const targets = ref<{ id: string; name: string }[]>([])

/** The schedule as the user would have typed it. */
function scheduleText(j?: Job): string {
	const s = j?.schedule
	if (!s) return ''
	if (typeof s === 'string') return s
	if (s.kind === 'cron' && s.expr) return String(s.expr)
	if (s.kind === 'interval' && s.minutes) return `every ${s.minutes}m`
	if (s.kind === 'once' && s.run_at) return String(s.run_at)
	return j?.schedule_display ?? String(s.display ?? '')
}
function repeatTimes(j?: Job): number | null {
	const r = j?.repeat
	if (r && typeof r === 'object') return r.times ?? null
	return typeof r === 'number' ? r : null
}

const initial = {
	// `agent` runs the prompt through Hermes; `script` runs a script on the Hermes host without the agent.
	kind: (props.job?.no_agent ? 'script' : 'agent') as 'agent' | 'script',
	script: props.job?.no_agent ? (props.job.script ?? '') : '',
	name: props.job?.name ?? '',
	prompt: props.job?.prompt ?? '',
	schedule: scheduleText(props.job),
	deliver: props.job?.deliver ?? 'local',
	skills: (props.job?.skills ?? []).join(', '),
	repeat: repeatTimes(props.job)?.toString() ?? '',
}
const form = reactive({ ...initial })
const isEdit = computed(() => !!props.job)
const isScript = computed(() => form.kind === 'script')
// Script-only jobs are written through the dashboard: the gateway's job API cannot set a script.
const canScript = computed(() => !!app.dashboard?.ok)
const kinds = [
	{ value: 'agent', label: 'Hermes' },
	{ value: 'script', label: 'Script' },
] as const

const chips = [
	{ label: 'Every 30 minutes', value: 'every 30m' },
	{ label: 'Every hour', value: 'every 1h' },
	{ label: 'Every day at 9', value: '0 9 * * *' },
	{ label: 'Weekdays at 9', value: '0 9 * * 1-5' },
	{ label: 'Every Monday at 9', value: '0 9 * * 1' },
]

onMounted(async () => {
	if (!app.dashboard?.ok) return
	try {
		targets.value = await dashboard.deliveryTargets()
	} catch {
		targets.value = []
	}
})

// The current value may not be a known target (for example "origin").
const targetOptions = computed(() => {
	const list = [...targets.value]
	if (form.deliver && !list.some((t) => t.id === form.deliver)) list.unshift({ id: form.deliver, name: form.deliver })
	return list
})

const skillList = (s: string) =>
	s
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean)

async function save() {
	const name = form.name.trim()
	const schedule = form.schedule.trim()
	if (!name) return toasts.error('Give the schedule a name.')
	if (!schedule) return toasts.error('Add a schedule, for example "every 30m".')
	const script = form.script.trim()
	if (isScript.value && !canScript.value)
		return toasts.error('Script schedules need the Hermes dashboard. Connect it in Settings and try again.')
	if (isScript.value && !script) return toasts.error('Name the script to run, for example "backup.sh".')
	if (!isScript.value && !form.prompt.trim()) return toasts.error('Write what Hermes should do each time.')
	const repeatRaw = form.repeat.trim()
	const repeat = repeatRaw ? Number(repeatRaw) : null
	if (repeat !== null && (!Number.isInteger(repeat) || repeat < 1))
		return toasts.error('Repeat must be a whole number of 1 or more, or empty.')

	busy.value = true
	try {
		if (props.job) {
			const body: Record<string, unknown> = {}
			const kindChanged = form.kind !== initial.kind
			if (kindChanged) body.no_agent = isScript.value
			if (isScript.value && (kindChanged || script !== initial.script)) body.script = script
			// Back to Hermes: the script would otherwise run before every prompt and feed it its output.
			if (kindChanged && !isScript.value) body.script = null
			if (name !== initial.name) body.name = name
			if (schedule !== initial.schedule) body.schedule = schedule
			if (form.prompt !== initial.prompt) body.prompt = form.prompt
			if (form.deliver !== initial.deliver) body.deliver = form.deliver.trim() || 'local'
			if (form.skills !== initial.skills) body.skills = skillList(form.skills)
			if (form.repeat !== initial.repeat) {
				const done = typeof props.job.repeat === 'object' && props.job.repeat ? (props.job.repeat.completed ?? 0) : 0
				body.repeat = { times: repeat, completed: done }
			}
			if (!Object.keys(body).length) return emit('close')
			if ('script' in body || 'no_agent' in body) {
				const profile = typeof props.job.profile === 'string' ? props.job.profile : undefined
				await dashboard.updateCronJob(props.job.id, body, profile)
			} else await gateway.updateJob(props.job.id, body)
			toasts.push('Schedule saved')
		} else {
			const deliver = form.deliver.trim() || 'local'
			if (isScript.value)
				await dashboard.createCronJob({
					name,
					schedule,
					script,
					no_agent: true,
					deliver,
					...(repeat !== null ? { repeat } : {}),
				})
			else
				await gateway.createJob({
					name,
					schedule: schedule as any,
					prompt: form.prompt,
					deliver,
					...(skillList(form.skills).length ? { skills: skillList(form.skills) } : {}),
					...(repeat !== null ? { repeat: repeat as any } : {}),
				})
			toasts.push('Schedule created')
		}
		emit('saved')
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal :title="isEdit ? 'Edit schedule' : 'New schedule'" wide @close="emit('close')">
		<form id="schedule-form" class="space-y-4" @submit.prevent="save">
			<div>
				<label class="label" for="s-name">Name</label>
				<input id="s-name" v-model="form.name" class="field" maxlength="200" placeholder="Morning briefing" autofocus />
			</div>
			<div>
				<p class="label" id="s-kind">What runs</p>
				<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="s-kind">
					<button
						v-for="k in kinds"
						:key="k.value"
						type="button"
						role="radio"
						:aria-checked="form.kind === k.value"
						class="chip hover:bg-surface-3"
						:class="form.kind === k.value && 'bg-surface-3 text-ink'"
						@click="form.kind = k.value"
					>
						{{ k.label }}
					</button>
				</div>
				<p class="mt-1 text-xs text-ink-3">
					{{
						isScript
							? 'Runs a script on the Hermes host without the agent. Its output is saved and sent as the result.'
							: 'Hermes works through a prompt in a fresh session, with its tools and skills.'
					}}
				</p>
			</div>
			<div v-if="isScript">
				<label class="label" for="s-script">Script</label>
				<input
					id="s-script"
					v-model="form.script"
					class="field font-mono"
					placeholder="nightly-backup.sh"
					autocomplete="off"
					spellcheck="false"
					aria-describedby="s-script-help"
				/>
				<p id="s-script-help" class="mt-1 text-xs text-ink-3">
					<template v-if="canScript">
						A file in the <code class="font-mono">scripts</code> folder of the Hermes profile, for example
						<code class="font-mono">~/.hermes/scripts</code>. Put it there first: Hermes checks that it exists when you
						save.
					</template>
					<span v-else class="text-rose"
						>Script schedules are saved through the Hermes dashboard, which is not connected. Connect it in
						Settings.</span
					>
				</p>
			</div>
			<div v-else>
				<label class="label" for="s-prompt">What Hermes should do</label>
				<textarea
					id="s-prompt"
					v-model="form.prompt"
					class="field"
					rows="6"
					maxlength="5000"
					placeholder="Summarize the news I care about and send it to me."
				/>
				<p class="mt-1 text-xs text-ink-3">
					The prompt runs in a fresh session each time, so include everything Hermes needs to know.
				</p>
			</div>
			<div>
				<label class="label" for="s-schedule">When</label>
				<input
					id="s-schedule"
					v-model="form.schedule"
					class="field font-mono"
					placeholder="every 30m"
					autocomplete="off"
					aria-describedby="s-schedule-help"
				/>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<button
						v-for="c in chips"
						:key="c.value"
						type="button"
						class="chip hover:bg-surface-3"
						:class="form.schedule === c.value && 'bg-surface-3 text-ink'"
						@click="form.schedule = c.value"
					>
						{{ c.label }}
					</button>
				</div>
				<p id="s-schedule-help" class="mt-2 text-xs text-ink-3">
					Accepts a repeating phrase like <code class="font-mono">every 30m</code> or
					<code class="font-mono">every monday 9am</code>, a cron expression like
					<code class="font-mono">0 9 * * *</code>, or a single time like
					<code class="font-mono">2026-12-15T08:00</code>.
				</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="s-deliver">Send the result to</label>
					<select v-if="targetOptions.length" id="s-deliver" v-model="form.deliver" class="field">
						<option v-for="t in targetOptions" :key="t.id" :value="t.id">{{ t.name }}</option>
					</select>
					<input v-else id="s-deliver" v-model="form.deliver" class="field" placeholder="local" />
				</div>
				<div>
					<label class="label" for="s-repeat">Repeat</label>
					<input
						id="s-repeat"
						v-model="form.repeat"
						class="field"
						type="number"
						min="1"
						step="1"
						placeholder="Forever"
					/>
					<p class="mt-1 text-xs text-ink-3">Stop after this many runs. Empty means no limit.</p>
				</div>
			</div>
			<div v-if="!isScript">
				<label class="label" for="s-skills">Skills</label>
				<input id="s-skills" v-model="form.skills" class="field" placeholder="Optional, separated by commas" />
			</div>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="schedule-form" :disabled="busy">
				{{ isEdit ? 'Save schedule' : 'Create schedule' }}
			</button>
		</template>
	</Modal>
</template>
