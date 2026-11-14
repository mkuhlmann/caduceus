import { config, saveConfig, type Connection } from './store'

/**
 * Where Hermes lives. The UI never touches the Hermes host's filesystem; it only
 * needs two URLs: the gateway API server (chat, sessions, jobs) and, optionally,
 * the dashboard (config, skills, kanban, webhooks).
 *
 * Set on the connection page and kept in `config.json`, or set by the `HERMES_*` environment variables, which win
 * and are never written to the file.
 */
export type { Connection }

const empty: Connection = {
	gatewayUrl: '',
	gatewayKey: '',
	dashboardUrl: '',
	dashboardToken: '',
	dashboardUsername: '',
	dashboardPassword: '',
}

function fromEnv(): Partial<Connection> {
	const e = process.env
	const out: Partial<Connection> = {}
	if (e.HERMES_GATEWAY_URL) out.gatewayUrl = e.HERMES_GATEWAY_URL
	if (e.HERMES_API_KEY) out.gatewayKey = e.HERMES_API_KEY
	if (e.HERMES_DASHBOARD_URL) out.dashboardUrl = e.HERMES_DASHBOARD_URL
	if (e.HERMES_DASHBOARD_TOKEN) out.dashboardToken = e.HERMES_DASHBOARD_TOKEN
	if (e.HERMES_DASHBOARD_USERNAME) out.dashboardUsername = e.HERMES_DASHBOARD_USERNAME
	if (e.HERMES_DASHBOARD_PASSWORD) out.dashboardPassword = e.HERMES_DASHBOARD_PASSWORD
	return out
}

export const envLocked = Object.keys(fromEnv()).length > 0

function normalize(c: Connection): Connection {
	const trim = (u: string) => u.trim().replace(/\/+$/, '')
	return { ...c, gatewayUrl: trim(c.gatewayUrl), dashboardUrl: trim(c.dashboardUrl) }
}

let current = normalize({ ...config.connection, ...fromEnv() })

export function getConnection(): Connection {
	return current
}

export function saveConnection(patch: Partial<Connection>) {
	// Secrets come back from the client redacted; keep the stored value unless replaced.
	const next = { ...config.connection }
	for (const k of Object.keys(empty) as (keyof Connection)[]) {
		const v = patch[k]
		if (typeof v === 'string' && v !== REDACTED) next[k] = v
	}
	config.connection = normalize(next)
	saveConfig()
	current = normalize({ ...config.connection, ...fromEnv() })
	listeners.forEach((fn) => fn())
}

const listeners: (() => void)[] = []
export function onConnectionChange(fn: () => void) {
	listeners.push(fn)
}

export const REDACTED = '••••••••'

export function publicConnection() {
	const c = current
	return {
		gatewayUrl: c.gatewayUrl,
		gatewayKey: c.gatewayKey ? REDACTED : '',
		dashboardUrl: c.dashboardUrl,
		dashboardToken: c.dashboardToken ? REDACTED : '',
		dashboardUsername: c.dashboardUsername,
		dashboardPassword: c.dashboardPassword ? REDACTED : '',
		envLocked,
	}
}
