import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'
import { get, put, post } from '@/lib/http'

export type ConnectionInfo = {
	gatewayUrl: string
	gatewayKey: string
	dashboardUrl: string
	dashboardToken: string
	dashboardUsername: string
	dashboardPassword: string
	envLocked: boolean
}

type Probe = { ok: boolean; status: number; detail?: string } | null

export const useApp = defineStore('app', () => {
	const theme = ref<'system' | 'light' | 'dark'>((localStorage.getItem('caduceus.theme') as any) ?? 'system')
	const media = matchMedia('(prefers-color-scheme: dark)')
	const systemDark = ref(media.matches)
	media.addEventListener('change', (e) => (systemDark.value = e.matches))

	watchEffect(() => {
		localStorage.setItem('caduceus.theme', theme.value)
		const dark = theme.value === 'dark' || (theme.value === 'system' && systemDark.value)
		document.documentElement.dataset.theme = dark ? 'dark' : 'light'
		document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#151936' : '#eef0f7')
	})

	const connection = ref<ConnectionInfo | null>(null)
	const gateway = ref<Probe>(null)
	const dashboard = ref<Probe>(null)
	const uiAuth = ref<{ required: boolean; authenticated: boolean } | null>(null)
	const ready = ref(false)

	async function load() {
		uiAuth.value = await get('ui-api/auth')
		if (uiAuth.value?.required && !uiAuth.value.authenticated) {
			ready.value = true
			return
		}
		connection.value = await get('ui-api/connection')
		// Assume the last known state so the UI paints at once; the probe corrects it.
		const cached = JSON.parse(localStorage.getItem('caduceus.probe') ?? 'null')
		if (cached) {
			gateway.value = cached.gateway
			dashboard.value = cached.dashboard
			ready.value = true
			test().catch(() => {})
			return
		}
		await test()
		ready.value = true
	}

	async function test() {
		const r = await post<{ gateway: Probe; dashboard: Probe }>('ui-api/connection/test')
		gateway.value = r.gateway
		dashboard.value = r.dashboard
		localStorage.setItem('caduceus.probe', JSON.stringify(r))
		return r
	}

	async function save(c: Partial<ConnectionInfo>) {
		connection.value = await put('ui-api/connection', c)
		return test()
	}

	async function login(password: string) {
		await post('ui-api/auth/login', { password })
		await load()
	}

	const hasGateway = () => !!gateway.value?.ok
	const hasDashboard = () => !!dashboard.value?.ok

	return { theme, connection, gateway, dashboard, uiAuth, ready, load, test, save, login, hasGateway, hasDashboard }
})
