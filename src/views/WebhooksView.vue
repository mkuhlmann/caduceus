<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Copy, Plus, Trash2 } from 'lucide-vue-next'
import { dashboard, type Webhook } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import WebhookForm from '@/components/webhooks/WebhookForm.vue'

const app = useApp()
const toasts = useToasts()
// Cached per session: a revisit paints the last list at once and refreshes it in the background.
const { data, error, pending, refreshing, reload, mutate } = useResource(
	() => (app.dashboard?.ok ? 'webhooks' : null),
	() => dashboard.webhooks(),
)
const creating = ref(false)
const enabling = ref(false)
const needsRestart = ref(false)
const busyName = ref('')

// Rows only animate in or out right after an action, never on the first paint.
const animate = ref(false)
let animateTimer: ReturnType<typeof setTimeout> | undefined
function animateNext() {
	animate.value = true
	clearTimeout(animateTimer)
	animateTimer = setTimeout(() => (animate.value = false), 600)
}
onBeforeUnmount(() => clearTimeout(animateTimer))

function patchList(fn: (list: Webhook[]) => Webhook[]) {
	mutate((d) => (d ? { ...d, subscriptions: fn(d.subscriptions) } : d))
}

async function enable() {
	enabling.value = true
	try {
		const r = await dashboard.enableWebhooks()
		needsRestart.value = !!r.needs_restart
		toasts.push('Webhooks turned on')
		await reload()
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		enabling.value = false
	}
}

async function copy(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		toasts.push('URL copied')
	} catch {
		toasts.error('Copy failed. Select the URL and copy it by hand.')
	}
}

async function setEnabled(w: Webhook, on: boolean) {
	busyName.value = w.name
	patchList((l) => l.map((x) => (x.name === w.name ? { ...x, enabled: on } : x)))
	try {
		await dashboard.setWebhookEnabled(w.name, on)
		toasts.push(on ? 'Webhook turned on' : 'Webhook turned off')
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busyName.value = ''
	}
	// Also puts the switch back if the change failed.
	await reload()
}

async function remove(w: Webhook) {
	if (!confirm(`Delete the webhook "${w.name}"? Services posting to its URL will get an error.`)) return
	busyName.value = w.name
	animateNext()
	patchList((l) => l.filter((x) => x.name !== w.name))
	try {
		await dashboard.deleteWebhook(w.name)
		toasts.push('Webhook deleted')
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busyName.value = ''
	}
	await reload()
}

function created() {
	animateNext()
	reload()
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader
			title="Webhooks"
			subtitle="A webhook is a URL that an outside service, such as GitHub, posts to. Hermes then runs the webhook's prompt with what was sent."
		>
			<button v-if="data?.enabled" class="btn-primary" @click="creating = true"><Plus :size="16" />New webhook</button>
		</PageHeader>

		<EmptyState
			v-if="!app.dashboard?.ok"
			title="Webhooks need the dashboard"
			body="Webhooks are managed through the Hermes dashboard, which is not connected yet."
		>
			<router-link to="/connect" class="btn-outline">Open connection settings</router-link>
		</EmptyState>

		<div v-else class="relative px-6 pb-16 md:px-10">
			<div v-if="refreshing" class="absolute inset-x-6 top-0 md:inset-x-10" aria-hidden="true">
				<div class="refresh-bar" />
			</div>
			<p v-if="error" class="mb-4 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
				Could not load webhooks: {{ error }}. Check the dashboard connection.
			</p>
			<Skeleton v-if="pending" :count="3" label="Loading webhooks" />

			<div v-if="needsRestart" class="mb-6 max-w-[72ch] rounded-md bg-gold-soft px-3 py-2 text-sm">
				Webhooks are turned on, but the Hermes gateway has to be restarted before it starts listening. Restart it on the
				agent's machine, then reload this page.
			</div>

			<section v-if="data && !data.enabled" class="max-w-[72ch] space-y-3">
				<h2 class="text-lg">The webhook listener is off</h2>
				<p class="text-ink-2">
					Hermes only listens for incoming webhooks once you turn them on. After that you can create subscriptions and
					give their URLs to other services.
				</p>
				<button class="btn-primary" :disabled="enabling" @click="enable">Turn on webhooks</button>
			</section>

			<template v-else-if="data">
				<EmptyState
					v-if="!data.subscriptions.length"
					title="No webhooks yet"
					body="Create one, then paste its URL and secret into the service that should call Hermes."
				>
					<button class="btn-primary" @click="creating = true"><Plus :size="16" />New webhook</button>
				</EmptyState>
				<TransitionGroup
					v-else
					tag="ul"
					class="relative divide-y divide-line border-y border-line"
					:name="animate ? 'rise' : 'none'"
					:leave-active-class="animate ? 'rise-leave-active absolute inset-x-0' : undefined"
				>
					<li
						v-for="w in data.subscriptions"
						:key="w.name"
						class="flex flex-wrap items-start gap-x-4 gap-y-2 px-2 py-3"
					>
						<div class="min-w-0 flex-1 basis-72">
							<p class="truncate font-medium" :class="!w.enabled && 'text-ink-3'" :title="w.name">{{ w.name }}</p>
							<p v-if="w.description" class="truncate text-sm text-ink-2" :title="w.description">{{ w.description }}</p>
							<div class="mt-1 flex items-center gap-1">
								<code class="min-w-0 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs" :title="w.url">{{
									w.url
								}}</code>
								<button class="icon-btn size-7" aria-label="Copy URL" title="Copy URL" @click="copy(w.url)">
									<Copy :size="14" />
								</button>
							</div>
							<p class="mt-1 text-sm text-ink-3">
								{{ w.events?.length ? `Events: ${w.events.join(', ')}` : 'All events' }}.
								{{ w.deliver_only ? 'Forwards to' : 'Result goes to' }} {{ w.deliver }}.
							</p>
						</div>
						<div class="ml-auto flex items-center gap-2">
							<label class="flex items-center gap-2 text-sm text-ink-2">
								<input
									type="checkbox"
									role="switch"
									:checked="w.enabled"
									:disabled="busyName === w.name"
									@change="setEnabled(w, ($event.target as HTMLInputElement).checked)"
								/>
								{{ w.enabled ? 'On' : 'Off' }}
							</label>
							<button
								class="icon-btn hover:text-rose"
								:disabled="busyName === w.name"
								aria-label="Delete webhook"
								title="Delete webhook"
								@click="remove(w)"
							>
								<Trash2 :size="16" />
							</button>
						</div>
					</li>
				</TransitionGroup>
			</template>
		</div>

		<WebhookForm v-if="creating" @close="creating = false" @created="created" />
	</div>
</template>
