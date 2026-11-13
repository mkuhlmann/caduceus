<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Plus, SquarePen, Trash2, X, Zap } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ToggleSwitch from '@/components/settings/ToggleSwitch.vue'
import { dashboard } from '@/lib/dashboard'
import type { Job } from '@/lib/gateway'
import { useResource } from '@/lib/resource'
import { relative } from '@/lib/time'
import type { Bot } from '@/stores/bots'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'

/**
 * A bot's routines: recurring tasks attached to the bot that does them, as in Hermes Desktop. They are plain Hermes
 * cron jobs in the bot's own profile, named `[bot:<name>] <routine>`, and each run lands in the bot's Bot Chat.
 */
const props = defineProps<{ bot: Bot }>()
const emit = defineEmits<{ close: [] }>()
const toasts = useToasts()
const dialogs = useDialogs()

const TAG = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i
const { data, error, pending, reload, mutate } = useResource(
	`bot-routines:${props.bot.name}`,
	() => dashboard.botJobs(props.bot.name),
	{ on: ['cron.changed'] },
)
// Hermes' own cron jobs of this profile that are not routines stay on the Schedules page.
const routines = computed(() =>
	(data.value ?? []).filter((j) => TAG.exec(j.name)?.[1]?.toLowerCase() === props.bot.name.toLowerCase()),
)
const title = (j: Job) => j.name.replace(TAG, '')
const active = (j: Job) => j.enabled !== false && j.state !== 'paused' && !j.paused

// The form: frequency first, then only the detail that matters, with the raw Hermes schedule as an escape hatch.
type Freq = 'daily' | 'weekdays' | 'weekly' | 'hours' | 'once' | 'advanced'
const editing = ref<Job | 'new' | null>(null)
const form = reactive({
	title: '',
	instruction: '',
	freq: 'daily' as Freq,
	time: '08:00',
	day: '1',
	hours: 4,
	minutes: 30,
	raw: '',
	repeat: '',
})
const DAYS = [
	['1', 'Monday'],
	['2', 'Tuesday'],
	['3', 'Wednesday'],
	['4', 'Thursday'],
	['5', 'Friday'],
	['6', 'Saturday'],
	['0', 'Sunday'],
] as const
const busy = ref(false)

const schedule = computed(() => {
	const [h, m] = form.time.split(':').map((x) => parseInt(x, 10) || 0)
	switch (form.freq) {
		case 'daily':
			return `${m} ${h} * * *`
		case 'weekdays':
			return `${m} ${h} * * 1-5`
		case 'weekly':
			return `${m} ${h} * * ${form.day}`
		case 'hours':
			return `every ${Math.max(1, form.hours)}h`
		case 'once':
			return `${Math.max(1, form.minutes)}m`
		default:
			return form.raw.trim()
	}
})

function scheduleText(j: Job) {
	const s = j.schedule
	if (typeof s === 'string') return s
	if (s?.kind === 'cron' && s.expr) return String(s.expr)
	return j.schedule_display ?? String(s?.display ?? '')
}

function open(j?: Job) {
	editing.value = j ?? 'new'
	form.title = j ? title(j) : ''
	form.instruction = j?.prompt ?? ''
	form.repeat = ''
	// An existing schedule is edited as written; picking a frequency again rebuilds it.
	form.freq = j ? 'advanced' : 'daily'
	form.raw = j ? scheduleText(j) : ''
}

async function save() {
	const t = form.title.trim()
	const task = form.instruction.trim()
	if (!t || !task) return toasts.error('Give the routine a name and say what the bot should do.')
	if (!schedule.value) return toasts.error('Add a schedule, for example "every 30m" or "0 8 * * *".')
	busy.value = true
	try {
		const name = `[bot:${props.bot.name}] ${t}`
		const repeat = form.repeat.trim() ? Math.max(1, parseInt(form.repeat, 10) || 1) : undefined
		if (editing.value === 'new')
			await dashboard.createBotJob(props.bot.name, {
				name,
				prompt: task,
				schedule: schedule.value,
				deliver: 'bot-chat',
				...(repeat ? { repeat } : form.freq === 'once' ? { repeat: 1 } : {}),
			})
		else if (editing.value)
			await dashboard.updateBotJob(props.bot.name, editing.value.id, {
				name,
				prompt: task,
				schedule: schedule.value,
				...(repeat ? { repeat } : {}),
			})
		toasts.push(editing.value === 'new' ? 'Routine created' : 'Routine saved')
		editing.value = null
		await reload()
	} catch (e) {
		toasts.error(`Could not save the routine: ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}

async function toggle(j: Job) {
	const on = !active(j)
	mutate((list) => list?.map((x) => (x.id === j.id ? { ...x, enabled: on, state: on ? 'scheduled' : 'paused' } : x)))
	try {
		await dashboard.botJobAction(props.bot.name, j.id, on ? 'resume' : 'pause')
	} catch (e) {
		toasts.error(`Could not ${on ? 'resume' : 'pause'} the routine: ${(e as Error).message}`)
	}
	await reload()
}

async function runNow(j: Job) {
	try {
		await dashboard.botJobAction(props.bot.name, j.id, 'trigger')
		toasts.push(`${title(j)} is running. The result lands in this chat.`)
	} catch (e) {
		toasts.error(`Could not run the routine: ${(e as Error).message}`)
	}
}

async function remove(j: Job) {
	const ok = await dialogs.confirm({
		title: `Delete ${title(j)}?`,
		body: 'The routine stops running for this bot and cannot be restored.',
		action: 'Delete routine',
		danger: true,
	})
	if (!ok) return
	try {
		await dashboard.deleteBotJob(props.bot.name, j.id)
		mutate((list) => list?.filter((x) => x.id !== j.id))
		toasts.push('Routine deleted')
	} catch (e) {
		toasts.error(`Could not delete the routine: ${(e as Error).message}`)
	}
}
</script>

<template>
	<aside class="flex h-full w-full flex-col bg-surface md:w-80 md:border-l md:border-line" aria-label="Routines">
		<div class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
			<h2 class="font-semibold">Routines</h2>
			<span class="flex gap-1">
				<button v-if="!editing" class="icon-btn" aria-label="New routine" title="New routine" @click="open()">
					<Plus :size="18" />
				</button>
				<button class="icon-btn" aria-label="Close routines" @click="emit('close')"><X :size="18" /></button>
			</span>
		</div>

		<form v-if="editing" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" @submit.prevent="save">
			<div>
				<label class="label" for="r-title">Name</label>
				<input id="r-title" v-model="form.title" class="field" placeholder="Morning inbox summary" maxlength="120" />
			</div>
			<div>
				<label class="label" for="r-task">What {{ bot.displayName }} should do</label>
				<textarea
					id="r-task"
					v-model="form.instruction"
					class="field"
					rows="4"
					placeholder="Summarize what came into my inbox overnight and flag anything urgent."
				/>
			</div>
			<div>
				<label class="label" for="r-freq">When</label>
				<select id="r-freq" v-model="form.freq" class="field">
					<option value="daily">Every day</option>
					<option value="weekdays">Every weekday</option>
					<option value="weekly">Every week</option>
					<option value="hours">Every few hours</option>
					<option value="once">Once, later</option>
					<option value="advanced">Advanced (Hermes schedule)</option>
				</select>
			</div>
			<div v-if="form.freq === 'weekly'">
				<label class="label" for="r-day">Day</label>
				<select id="r-day" v-model="form.day" class="field">
					<option v-for="[v, l] in DAYS" :key="v" :value="v">{{ l }}</option>
				</select>
			</div>
			<div v-if="['daily', 'weekdays', 'weekly'].includes(form.freq)">
				<label class="label" for="r-time">Time</label>
				<input id="r-time" v-model="form.time" type="time" class="field" />
			</div>
			<div v-if="form.freq === 'hours'">
				<label class="label" for="r-hours">Every how many hours</label>
				<input id="r-hours" v-model.number="form.hours" type="number" min="1" max="168" class="field" />
			</div>
			<div v-if="form.freq === 'once'">
				<label class="label" for="r-min">In how many minutes</label>
				<input id="r-min" v-model.number="form.minutes" type="number" min="1" class="field" />
			</div>
			<div v-if="form.freq === 'advanced'">
				<label class="label" for="r-raw">Schedule</label>
				<input id="r-raw" v-model="form.raw" class="field font-mono" placeholder="every monday 9am" />
				<p class="mt-1 text-sm text-ink-3">A phrase like every 30m, or a cron expression like 0 8 * * 1-5.</p>
			</div>
			<div v-if="form.freq !== 'once'">
				<label class="label" for="r-repeat">Stop after</label>
				<input id="r-repeat" v-model="form.repeat" type="number" min="1" class="field" placeholder="Never" />
			</div>
			<p class="text-sm text-ink-3">Each run lands in {{ bot.displayName }}’s chat.</p>
			<div class="mt-auto flex justify-end gap-2 pt-2">
				<button type="button" class="btn-ghost" @click="editing = null">Cancel</button>
				<button type="submit" class="btn-primary" :disabled="busy">
					{{ editing === 'new' ? 'Create routine' : 'Save routine' }}
				</button>
			</div>
		</form>

		<div v-else class="min-h-0 flex-1 overflow-y-auto">
			<p v-if="error && !data" class="m-4 rounded-md bg-rose-soft px-3 py-2 text-sm">
				Could not load the routines. {{ error }}
			</p>
			<Skeleton v-else-if="pending" variant="rows" :count="2" label="Loading routines" class="p-4" />
			<div v-else-if="!routines.length" class="p-4 text-sm text-ink-2">
				<p class="mb-3">
					Give {{ bot.displayName }} recurring work, like a morning summary or a weekly check. Each run lands in this
					chat.
				</p>
				<button class="btn-outline" @click="open()"><Plus :size="16" /> New routine</button>
			</div>
			<ul v-else class="divide-y divide-line">
				<li v-for="j in routines" :key="j.id" class="px-4 py-3" :class="{ 'opacity-60': !active(j) }">
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{{ title(j) }}</p>
							<p class="truncate text-sm text-ink-3">{{ j.schedule_display || scheduleText(j) }}</p>
							<p v-if="active(j) && j.next_run_at" class="text-xs text-ink-3">Next {{ relative(j.next_run_at) }}</p>
							<p v-else-if="!active(j)" class="text-xs text-ink-3">Paused</p>
							<p v-if="j.last_error" class="mt-1 text-xs text-rose">{{ j.last_error }}</p>
						</div>
						<ToggleSwitch
							:model-value="active(j)"
							:label="active(j) ? `Pause ${title(j)}` : `Resume ${title(j)}`"
							@update:model-value="toggle(j)"
						/>
					</div>
					<div class="mt-2 flex gap-1">
						<button class="btn-ghost h-7" @click="runNow(j)"><Zap :size="14" /> Run now</button>
						<button class="btn-ghost h-7" @click="open(j)"><SquarePen :size="14" /> Edit</button>
						<button class="btn-danger h-7" :aria-label="`Delete ${title(j)}`" @click="remove(j)">
							<Trash2 :size="14" />
						</button>
					</div>
				</li>
			</ul>
		</div>
	</aside>
</template>
