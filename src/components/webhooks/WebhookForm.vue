<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Copy } from 'lucide-vue-next'
import { dashboard } from '@/lib/dashboard'
import { useToasts } from '@/stores/toast'
import Modal from '@/components/Modal.vue'

const emit = defineEmits<{ close: []; created: [] }>()
const toasts = useToasts()
const busy = ref(false)
const targets = ref<{ id: string; name: string }[]>([])
const created = ref<{ url: string; secret?: string } | null>(null)

const form = reactive({
	name: '',
	description: '',
	events: '',
	prompt: '',
	skills: '',
	deliver: 'log',
	deliver_only: false,
	secret: '',
})

onMounted(async () => {
	try {
		targets.value = await dashboard.deliveryTargets()
	} catch {}
})

const options = computed(() => [
	{ id: 'log', name: 'Log only (keep in the gateway log)' },
	...targets.value.filter((t) => t.id !== 'log'),
])
const nameOk = computed(() => /^[a-z0-9][a-z0-9_-]*$/.test(form.name))
const list = (s: string) =>
	s
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean)

async function copy(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text)
		toasts.push(`${what} copied`)
	} catch {
		toasts.error('Copy failed. Select the text and copy it by hand.')
	}
}

async function save() {
	if (!nameOk.value)
		return toasts.error(
			'Use a name with lowercase letters, numbers, hyphens or underscores, starting with a letter or number.',
		)
	if (form.deliver_only && form.deliver === 'log')
		return toasts.error('Forwarding without the agent needs a real delivery target, not the log.')
	busy.value = true
	try {
		const r = await dashboard.createWebhook({
			name: form.name,
			description: form.description.trim() || undefined,
			events: list(form.events),
			prompt: form.prompt.trim() || undefined,
			skills: list(form.skills),
			deliver: form.deliver,
			deliver_only: form.deliver_only || undefined,
			secret: form.secret.trim() || undefined,
		})
		toasts.push('Webhook created')
		created.value = { url: r.url, secret: r.secret }
		emit('created')
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal :title="created ? 'Webhook created' : 'New webhook'" wide @close="emit('close')">
		<div v-if="created" class="space-y-4">
			<div>
				<p class="label">URL to give the outside service</p>
				<div class="flex items-center gap-2">
					<code class="min-w-0 flex-1 break-all rounded bg-surface-2 px-2 py-1.5 font-mono text-xs">{{
						created.url
					}}</code>
					<button class="icon-btn" aria-label="Copy URL" title="Copy URL" @click="copy(created.url, 'URL')">
						<Copy :size="16" />
					</button>
				</div>
			</div>
			<div v-if="created.secret">
				<p class="label">Secret</p>
				<div class="flex items-center gap-2">
					<code class="min-w-0 flex-1 break-all rounded bg-surface-2 px-2 py-1.5 font-mono text-xs">{{
						created.secret
					}}</code>
					<button
						class="icon-btn"
						aria-label="Copy secret"
						title="Copy secret"
						@click="copy(created.secret!, 'Secret')"
					>
						<Copy :size="16" />
					</button>
				</div>
				<p class="mt-2 rounded-md bg-rose-soft px-3 py-2 text-sm">
					Copy the secret now. It will not be shown again. The outside service uses it to sign its requests.
				</p>
			</div>
		</div>

		<form v-else id="webhook-form" class="space-y-4" @submit.prevent="save">
			<div>
				<label class="label" for="w-name">Name</label>
				<input
					id="w-name"
					v-model="form.name"
					class="field"
					placeholder="github-issues"
					autocomplete="off"
					autofocus
					aria-describedby="w-name-help"
				/>
				<p id="w-name-help" class="mt-1 text-xs" :class="form.name && !nameOk ? 'text-rose' : 'text-ink-3'">
					Lowercase letters, numbers, hyphens and underscores, starting with a letter or number. It becomes part of the
					URL.
				</p>
			</div>
			<div>
				<label class="label" for="w-desc">Description</label>
				<input id="w-desc" v-model="form.description" class="field" placeholder="Optional" />
			</div>
			<div>
				<label class="label" for="w-events">Events</label>
				<input
					id="w-events"
					v-model="form.events"
					class="field"
					placeholder="Optional, for example issues, pull_request"
				/>
				<p class="mt-1 text-xs text-ink-3">Only these event types are handled. Leave empty to accept all.</p>
			</div>
			<div>
				<label class="label" for="w-prompt">Prompt</label>
				<textarea
					id="w-prompt"
					v-model="form.prompt"
					class="field"
					rows="5"
					placeholder="A new issue was opened: {issue.title}. Triage it."
				/>
				<p class="mt-1 text-xs text-ink-3">
					Use <code class="font-mono">{field.name}</code> to insert a value from the payload,
					<code class="font-mono">{event_type}</code> for the event, or <code class="font-mono">{__raw__}</code> for the
					whole payload. Empty sends the raw payload to Hermes.
				</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="w-deliver">Send the result to</label>
					<select id="w-deliver" v-model="form.deliver" class="field">
						<option v-for="t in options" :key="t.id" :value="t.id">{{ t.name }}</option>
					</select>
				</div>
				<div>
					<label class="label" for="w-skills">Skills</label>
					<input id="w-skills" v-model="form.skills" class="field" placeholder="Optional, separated by commas" />
				</div>
			</div>
			<label class="flex items-start gap-2 text-sm">
				<input v-model="form.deliver_only" type="checkbox" class="mt-1" />
				<span
					>Forward the payload without running the agent<span class="block text-xs text-ink-3"
						>The rendered prompt is sent as a message as it is. Needs a delivery target other than the log.</span
					></span
				>
			</label>
			<div>
				<label class="label" for="w-secret">Secret</label>
				<input
					id="w-secret"
					v-model="form.secret"
					class="field"
					type="password"
					autocomplete="off"
					placeholder="Optional"
				/>
				<p class="mt-1 text-xs text-ink-3">Leave empty and Hermes generates one for you.</p>
			</div>
		</form>

		<template #footer>
			<template v-if="created"><button class="btn-primary" @click="emit('close')">Done</button></template>
			<template v-else>
				<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
				<button class="btn-primary" type="submit" form="webhook-form" :disabled="busy">Create webhook</button>
			</template>
		</template>
	</Modal>
</template>
