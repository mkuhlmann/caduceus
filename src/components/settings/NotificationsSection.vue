<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { patch, post } from '@/lib/http'
import { onRpcEvent } from '@/lib/rpc'
import { relative } from '@/lib/time'
import { EVENT_KINDS, EVENT_LABELS, type EventKind, type NotifyConfig, type Target } from '@/lib/notifications'
import {
	currentSubscription,
	deviceId,
	disablePush,
	enablePush,
	notifyState,
	pushSupport,
	type NotifyState,
} from '@/lib/push'
import { useDialogs } from '@/stores/dialogs'
import { useToasts } from '@/stores/toast'

const toasts = useToasts()
const dialogs = useDialogs()

const state = ref<NotifyState | null>(null)
const error = ref('')
const support = ref(pushSupport())
const subscribed = ref(false)
const busy = ref(false)
const testing = ref(false)

const me = deviceId()
const thisDevice = computed(() => state.value?.devices.some((d) => d.device === me) ?? false)
const on = computed(() => thisDevice.value && subscribed.value)

async function load() {
	try {
		state.value = await notifyState()
		subscribed.value = !!(await currentSubscription().catch(() => null))
		error.value = ''
	} catch (e) {
		error.value = (e as Error).message
	}
}
onMounted(load)
onRpcEvent('caduceus.notify', load)

const blocked: Record<Exclude<ReturnType<typeof pushSupport>, 'ready'>, string> = {
	denied:
		'Notifications are blocked for Caduceus in this browser. Allow them in the site settings, then come back here.',
	insecure: 'Notifications need Caduceus on an https address. Open it through https, then turn them on here.',
	install:
		'On iPhone and iPad, add Caduceus to your Home Screen first (Share, then Add to Home Screen) and open it from there.',
	unsupported: 'This browser cannot receive notifications. Use Chrome, Edge, Firefox or Safari.',
	desktop: 'The desktop app shows no notifications yet. Turn them on in a browser or on your phone.',
	dev: 'Notifications work in the built app only, not on the Vite dev server.',
}

async function toggleDevice(want: boolean) {
	busy.value = true
	try {
		state.value = want ? await enablePush(state.value!.publicKey) : await disablePush()
		subscribed.value = want
		toasts.push(want ? 'Notifications turned on' : 'Notifications turned off')
	} catch (e) {
		toasts.error(`Could not turn notifications ${want ? 'on' : 'off'}. ${(e as Error).message}`)
	} finally {
		support.value = pushSupport()
		busy.value = false
	}
}

async function save(change: Partial<NotifyConfig>, what: string) {
	try {
		state.value = await patch<NotifyState>('ui-api/notify', change)
	} catch (e) {
		toasts.error(`Could not save ${what}. ${(e as Error).message}`)
		await load()
	}
}

function setEvent(kind: EventKind, v: boolean) {
	const events = { ...state.value!.config.events, [kind]: v }
	state.value = { ...state.value!, config: { ...state.value!.config, events } }
	void save({ events }, 'which notices go out')
}

function setQuiet(v: boolean) {
	state.value = { ...state.value!, config: { ...state.value!.config, quietWhileActive: v } }
	void save({ quietWhileActive: v }, 'the quiet setting')
}

async function sendTest() {
	testing.value = true
	try {
		const r = await post<{ devices: number; channels: number; failed: string[] }>('ui-api/notify/test')
		const reached = [
			r.devices ? `${r.devices} ${r.devices === 1 ? 'device' : 'devices'}` : '',
			r.channels ? `${r.channels} ${r.channels === 1 ? 'channel' : 'channels'}` : '',
		].filter(Boolean)
		if (r.failed.length) toasts.error(`Some did not get the test: ${r.failed.join('; ')}`)
		else if (reached.length) toasts.push(`Test sent to ${reached.join(' and ')}`)
		else toasts.push('Nothing to send to yet. Turn on a device or add a channel.')
	} catch (e) {
		toasts.error(`Could not send the test. ${(e as Error).message}`)
	} finally {
		testing.value = false
	}
}

// Channels
const newKind = ref<Target['kind']>('ntfy')
const newUrl = ref('')
const newToken = ref('')
const adding = ref(false)

const kindName = (t: Target) => (t.kind === 'ntfy' ? 'ntfy topic' : 'Webhook')

async function addTarget() {
	const url = newUrl.value.trim()
	if (!url) return
	const target: Target =
		newKind.value === 'ntfy'
			? { kind: 'ntfy', url, ...(newToken.value.trim() ? { token: newToken.value.trim() } : {}) }
			: { kind: 'webhook', url }
	adding.value = true
	try {
		state.value = await patch<NotifyState>('ui-api/notify', {
			targets: [...state.value!.config.targets, target],
			appUrl: new URL('./', location.href).href.replace(/#.*$/, ''),
		})
		newUrl.value = ''
		newToken.value = ''
		toasts.push('Channel added')
	} catch (e) {
		toasts.error(`Could not add the channel. ${(e as Error).message}`)
	} finally {
		adding.value = false
	}
}

async function removeTarget(i: number) {
	const t = state.value!.config.targets[i]!
	const ok = await dialogs.confirm({
		title: 'Remove channel',
		body: `${kindName(t)} ${t.url} gets no more notifications.`,
		action: 'Remove channel',
		danger: true,
	})
	if (!ok) return
	try {
		state.value = await patch<NotifyState>('ui-api/notify', {
			targets: state.value!.config.targets.filter((_, j) => j !== i),
		})
		toasts.push('Channel removed')
	} catch (e) {
		toasts.error(`Could not remove the channel. ${(e as Error).message}`)
	}
}
</script>

<template>
	<div class="max-w-xl">
		<p v-if="error" class="text-rose">
			Could not load the notification settings. {{ error }} <button class="underline" @click="load">Try again</button>
		</p>
		<Skeleton v-else-if="!state" variant="rows" :count="4" label="Loading notification settings" />
		<template v-else>
			<h3 class="font-semibold">This device</h3>
			<div v-if="support === 'ready'" class="mt-3 flex items-center gap-3">
				<ToggleSwitch
					:model-value="on"
					:disabled="busy"
					label="Notify me on this device"
					@update:model-value="toggleDevice"
				/>
				<span class="text-sm font-medium">Notify me on this device</span>
			</div>
			<p v-else class="mt-2 text-sm text-ink-2">{{ blocked[support] }}</p>
			<p class="mt-1 text-sm text-ink-2">
				Notifications arrive while Caduceus is closed. The relay watches Hermes for you, so it must stay running.
			</p>

			<ul v-if="state.devices.length" class="mt-4 divide-y divide-line border-y border-line">
				<li v-for="d in state.devices" :key="d.device" class="flex items-center gap-3 py-2.5 text-sm">
					<span class="min-w-0 flex-1 truncate">{{ d.label }}</span>
					<span v-if="d.device === me" class="chip">This device</span>
					<span class="text-ink-3">Added {{ relative(d.createdAt) }}</span>
				</li>
			</ul>
			<button
				class="btn-outline mt-4"
				:disabled="testing || (!state.devices.length && !state.config.targets.length)"
				@click="sendTest"
			>
				Send a test notification
			</button>

			<h3 class="mt-10 font-semibold">What notifies you</h3>
			<p class="mt-1 text-sm text-ink-2">For every device and channel.</p>
			<div v-for="kind in EVENT_KINDS" :key="kind" class="mt-4">
				<div class="flex items-center gap-3">
					<ToggleSwitch
						:model-value="state.config.events[kind]"
						:label="EVENT_LABELS[kind].label"
						@update:model-value="setEvent(kind, $event)"
					/>
					<span class="text-sm font-medium">{{ EVENT_LABELS[kind].label }}</span>
				</div>
				<p class="mt-1 text-sm text-ink-2">{{ EVENT_LABELS[kind].hint }}</p>
			</div>

			<div class="mt-6 flex items-center gap-3">
				<ToggleSwitch
					:model-value="state.config.quietWhileActive"
					label="Stay quiet while I use Caduceus"
					@update:model-value="setQuiet"
				/>
				<span class="text-sm font-medium">Stay quiet while I use Caduceus</span>
			</div>
			<p class="mt-1 text-sm text-ink-2">
				While you use Caduceus on one device, no other device or channel is told. The chat you are looking at never
				notifies you, either way.
			</p>

			<h3 class="mt-10 font-semibold">Other channels</h3>
			<p class="mt-1 text-sm text-ink-2">
				Every notice also goes to these: an
				<a class="underline" href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> topic, or a webhook that
				gets it as JSON.
			</p>
			<ul v-if="state.config.targets.length" class="mt-3 divide-y divide-line border-y border-line">
				<li v-for="(t, i) in state.config.targets" :key="t.kind + t.url" class="flex items-center gap-3 py-2.5 text-sm">
					<span class="shrink-0 text-ink-2">{{ kindName(t) }}</span>
					<span class="min-w-0 flex-1 truncate font-mono text-xs">{{ t.url }}</span>
					<button class="icon-btn" :aria-label="`Remove ${kindName(t)} ${t.url}`" @click="removeTarget(i)">
						<Trash2 :size="16" />
					</button>
				</li>
			</ul>
			<form class="mt-4 space-y-3" @submit.prevent="addTarget">
				<div>
					<label class="label" for="notify-kind">Kind</label>
					<select id="notify-kind" v-model="newKind" class="field">
						<option value="ntfy">ntfy topic</option>
						<option value="webhook">Webhook</option>
					</select>
				</div>
				<div>
					<label class="label" for="notify-url">Address</label>
					<input
						id="notify-url"
						v-model="newUrl"
						class="field"
						type="url"
						required
						:placeholder="newKind === 'ntfy' ? 'https://ntfy.sh/my-topic' : 'https://example.com/hook'"
					/>
				</div>
				<div v-if="newKind === 'ntfy'">
					<label class="label" for="notify-token">Access token</label>
					<input id="notify-token" v-model="newToken" class="field" type="password" autocomplete="off" />
					<p class="mt-1 text-sm text-ink-2">Only for a protected topic. Leave it empty otherwise.</p>
				</div>
				<button class="btn-primary" type="submit" :disabled="adding || !newUrl.trim()">Add channel</button>
			</form>
		</template>
	</div>
</template>
