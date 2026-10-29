<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import PageHeader from '@/components/PageHeader.vue'

const app = useApp()
const toasts = useToasts()
const router = useRouter()
const busy = ref(false)
const form = reactive({
	gatewayUrl: '',
	gatewayKey: '',
	dashboardUrl: '',
	dashboardToken: '',
	dashboardUsername: '',
	dashboardPassword: '',
})

watch(
	() => app.connection,
	(c) => c && Object.assign(form, c),
	{ immediate: true },
)

async function save() {
	busy.value = true
	try {
		const r = await app.save(form)
		if (r.gateway?.ok) {
			toasts.push('Connected to Hermes')
			router.push('/chat')
		}
	} catch (e) {
		toasts.error((e as Error).message)
	} finally {
		busy.value = false
	}
}

async function retest() {
	busy.value = true
	await app.test().finally(() => (busy.value = false))
}

function describe(p: { ok: boolean; status: number; detail?: string } | null) {
	if (!p) return { tone: 'text-ink-3', text: 'Not configured' }
	if (p.ok) return { tone: 'text-verdigris', text: 'Connected' }
	if (p.status === 401) return { tone: 'text-rose', text: 'Rejected the credentials' }
	if (p.status === 502 || p.status === 0)
		return { tone: 'text-rose', text: 'Not reachable. Check the address and that the service is running.' }
	return { tone: 'text-rose', text: `Answered with ${p.status}` }
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader
			title="Connection"
			subtitle="Caduceus talks to your agent over its public APIs. Nothing needs to run on the agent's machine."
		/>
		<form class="max-w-2xl space-y-8 px-6 pb-16 md:px-10" @submit.prevent="save">
			<p v-if="app.connection?.envLocked" class="rounded-md bg-gold-soft px-3 py-2 text-sm">
				These settings come from environment variables on the Caduceus server and can only be changed there.
			</p>

			<fieldset class="space-y-4" :disabled="app.connection?.envLocked">
				<div class="flex items-baseline justify-between gap-4">
					<legend class="text-lg font-semibold">Gateway API</legend>
					<span class="text-sm" :class="describe(app.gateway).tone">{{ describe(app.gateway).text }}</span>
				</div>
				<p class="text-sm text-ink-2">
					Chat, history, approvals and schedules. Enable it on the agent with
					<code class="rounded bg-surface-2 px-1 font-mono text-xs">API_SERVER_ENABLED=true</code>.
				</p>
				<div>
					<label class="label" for="gw-url">Address</label>
					<input
						id="gw-url"
						v-model="form.gatewayUrl"
						class="field"
						placeholder="https://hermes.example.com:8642"
						autocomplete="url"
					/>
				</div>
				<div>
					<label class="label" for="gw-key">API key</label>
					<input
						id="gw-key"
						v-model="form.gatewayKey"
						class="field"
						type="password"
						placeholder="API_SERVER_KEY"
						autocomplete="off"
					/>
				</div>
			</fieldset>

			<fieldset class="space-y-4" :disabled="app.connection?.envLocked">
				<div class="flex items-baseline justify-between gap-4">
					<legend class="text-lg font-semibold">Dashboard</legend>
					<span class="text-sm" :class="describe(app.dashboard).tone">{{ describe(app.dashboard).text }}</span>
				</div>
				<p class="text-sm text-ink-2">
					Configuration, skills, board, webhooks and full-text search. Optional, but most pages need it.
				</p>
				<div>
					<label class="label" for="dash-url">Address</label>
					<input
						id="dash-url"
						v-model="form.dashboardUrl"
						class="field"
						placeholder="https://hermes.example.com:9119"
					/>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="label" for="dash-user">Username</label>
						<input id="dash-user" v-model="form.dashboardUsername" class="field" autocomplete="off" />
					</div>
					<div>
						<label class="label" for="dash-pass">Password</label>
						<input id="dash-pass" v-model="form.dashboardPassword" class="field" type="password" autocomplete="off" />
					</div>
				</div>
				<div>
					<label class="label" for="dash-token">Or a session token</label>
					<input
						id="dash-token"
						v-model="form.dashboardToken"
						class="field"
						type="password"
						placeholder="HERMES_DASHBOARD_SESSION_TOKEN"
						autocomplete="off"
					/>
					<p class="mt-1 text-xs text-ink-3">
						Leave all three empty for a dashboard reached through an SSH tunnel on localhost.
					</p>
				</div>
			</fieldset>

			<div class="flex gap-2">
				<button v-if="!app.connection?.envLocked" class="btn-primary" type="submit" :disabled="busy">
					Save and connect
				</button>
				<button class="btn-outline" type="button" :disabled="busy" @click="retest">Test again</button>
			</div>
		</form>
	</div>
</template>
