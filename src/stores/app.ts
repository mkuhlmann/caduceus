import { defineStore } from 'pinia'
import { ref, watch, watchEffect } from 'vue'
import { get, put, post } from '@/lib/http'
import { setTranscriptScope } from '@/lib/transcript-cache'

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

export type StartPage = 'chat' | 'bots'
const START_KEY = 'caduceus.startPage'

function savedStartPage(): StartPage {
	return localStorage.getItem(START_KEY) === 'bots' ? 'bots' : 'chat'
}

/** Where opening the app (or its home link) lands: the chat or the bots, as chosen in Settings. */
export function homePath() {
	return `/${savedStartPage()}`
}

/** The colour scheme used while the theme is dark. */
export type DarkPalette = 'lapis' | 'graphite'
const PALETTE_KEY = 'caduceus.darkColours'
const TINT_KEY = 'caduceus.tintMessages'
const STATS_KEY = 'caduceus.runStats'
const DARK_BG: Record<DarkPalette, string> = { lapis: '#151936', graphite: '#1e1d1d' }

export const useApp = defineStore('app', () => {
	const theme = ref<'system' | 'light' | 'dark'>((localStorage.getItem('caduceus.theme') as any) ?? 'system')
	const darkPalette = ref<DarkPalette>(localStorage.getItem(PALETTE_KEY) === 'lapis' ? 'lapis' : 'graphite')
	// Saved only once chosen, so people who never pick one follow the default.
	watch(darkPalette, (v) => localStorage.setItem(PALETTE_KEY, v))
	const media = matchMedia('(prefers-color-scheme: dark)')
	const systemDark = ref(media.matches)
	media.addEventListener('change', (e) => (systemDark.value = e.matches))

	watchEffect(() => {
		localStorage.setItem('caduceus.theme', theme.value)
		const dark = theme.value === 'dark' || (theme.value === 'system' && systemDark.value)
		document.documentElement.dataset.theme = dark ? 'dark' : 'light'
		document.documentElement.dataset.palette = darkPalette.value
		document
			.querySelector('meta[name=theme-color]')
			?.setAttribute('content', dark ? DARK_BG[darkPalette.value] : '#eef0f7')
	})

	// Your own messages in a bot's chat take the bot's colour.
	const tintMessages = ref(localStorage.getItem(TINT_KEY) !== 'off')
	watch(tintMessages, (v) => localStorage.setItem(TINT_KEY, v ? 'on' : 'off'))

	// A line under each reply with the model's speed and the turn's length. Off unless chosen.
	const runStats = ref(localStorage.getItem(STATS_KEY) === 'on')
	watch(runStats, (v) => localStorage.setItem(STATS_KEY, v ? 'on' : 'off'))

	const startPage = ref<StartPage>(savedStartPage())
	watchEffect(() => localStorage.setItem(START_KEY, startPage.value))

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
		setTranscriptScope(connection.value?.gatewayUrl ?? '')
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
		setTranscriptScope(connection.value?.gatewayUrl ?? '')
		return test()
	}

	async function login(password: string) {
		await post('ui-api/auth/login', { password })
		await load()
	}

	const hasGateway = () => !!gateway.value?.ok
	const hasDashboard = () => !!dashboard.value?.ok

	return {
		theme,
		darkPalette,
		tintMessages,
		runStats,
		startPage,
		connection,
		gateway,
		dashboard,
		uiAuth,
		ready,
		load,
		test,
		save,
		login,
		hasGateway,
		hasDashboard,
	}
})
