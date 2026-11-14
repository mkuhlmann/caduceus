import { defineStore } from 'pinia'
import { ref, watch, watchEffect } from 'vue'
import { get, put, post } from '@/lib/http'
import { setTranscriptScope } from '@/lib/transcript-cache'
import { usePreferences } from '@/stores/preferences'
import { useReadMarks } from '@/stores/read-marks'

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
// The last known sign-in and connection, and the last connection probe, so opening the app paints at once.
const BOOT_KEY = 'caduceus.boot'
const PROBE_KEY = 'caduceus.probe'
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

	const startPage = ref<StartPage>(savedStartPage())
	watchEffect(() => localStorage.setItem(START_KEY, startPage.value))

	const connection = ref<ConnectionInfo | null>(null)
	const gateway = ref<Probe>(null)
	const dashboard = ref<Probe>(null)
	/** The dashboard can show bots' chats live, with their approvals (the Webapp); null when unknown. */
	const liveBots = ref<boolean | null>(null)
	const uiAuth = ref<{ required: boolean; authenticated: boolean } | null>(null)
	const ready = ref(false)

	type Auth = { required: boolean; authenticated: boolean }

	/**
	 * Opening the app paints at once from the last known state (signed in, the connection, the probe) and checks it
	 * against the relay meanwhile; a session that ended meanwhile shows the sign-in. Only the first launch, or one
	 * after signing out, waits for the relay.
	 */
	async function load() {
		const known = savedBoot()
		if (known) {
			apply(known.uiAuth, known.connection)
			gateway.value = known.probe.gateway
			dashboard.value = known.probe.dashboard
			liveBots.value = known.probe.liveBots ?? null
			ready.value = true
			loadSynced()
			Promise.all([get<Auth>('ui-api/auth'), get<ConnectionInfo>('ui-api/connection').catch(() => null)])
				.then(([auth, conn]) => {
					uiAuth.value = auth
					if (!signedIn(auth)) return localStorage.removeItem(BOOT_KEY)
					if (conn) apply(auth, conn)
					test().catch(() => {})
				})
				// Offline or the relay is down: keep what is shown; the app catches up when it is back (lib/live.ts).
				.catch(() => {})
			return
		}
		const auth = await get<Auth>('ui-api/auth')
		uiAuth.value = auth
		if (!signedIn(auth)) {
			ready.value = true
			return
		}
		loadSynced()
		apply(auth, await get<ConnectionInfo>('ui-api/connection'))
		await test()
		ready.value = true
	}

	const signedIn = (a: Auth | null) => !!a && (!a.required || a.authenticated)

	function apply(auth: Auth, conn: ConnectionInfo) {
		uiAuth.value = auth
		if (conn.gatewayUrl !== connection.value?.gatewayUrl || !connection.value) setTranscriptScope(conn.gatewayUrl ?? '')
		connection.value = conn
		saveBoot()
	}

	/** Preferences and read marks, shared by all devices: read in the background. */
	function loadSynced() {
		usePreferences()
			.load()
			.catch(() => {})
		useReadMarks()
			.load()
			.catch(() => {})
	}

	type Boot = {
		uiAuth: Auth
		connection: ConnectionInfo
		probe: { gateway: Probe; dashboard: Probe; liveBots?: boolean | null }
	}
	function savedBoot(): Boot | null {
		try {
			const b = JSON.parse(localStorage.getItem(BOOT_KEY) ?? 'null')
			const probe = JSON.parse(localStorage.getItem(PROBE_KEY) ?? 'null')
			return b?.uiAuth && b.connection && probe && signedIn(b.uiAuth) ? { ...b, probe } : null
		} catch {
			return null
		}
	}
	function saveBoot() {
		if (uiAuth.value && connection.value)
			localStorage.setItem(BOOT_KEY, JSON.stringify({ uiAuth: uiAuth.value, connection: connection.value }))
	}

	async function test() {
		const r = await post<{ gateway: Probe; dashboard: Probe; liveBots?: boolean | null }>('ui-api/connection/test')
		gateway.value = r.gateway
		dashboard.value = r.dashboard
		liveBots.value = r.liveBots ?? null
		localStorage.setItem(PROBE_KEY, JSON.stringify(r))
		return r
	}

	async function save(c: Partial<ConnectionInfo>) {
		connection.value = await put('ui-api/connection', c)
		setTranscriptScope(connection.value?.gatewayUrl ?? '')
		saveBoot()
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
		startPage,
		connection,
		gateway,
		dashboard,
		liveBots,
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
