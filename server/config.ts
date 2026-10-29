import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * Where Hermes lives. The UI never touches the Hermes host's filesystem; it only
 * needs two URLs: the gateway API server (chat, sessions, jobs) and, optionally,
 * the dashboard (config, skills, kanban, webhooks).
 */
export type Connection = {
	gatewayUrl: string
	gatewayKey: string
	dashboardUrl: string
	dashboardToken: string
	/** Dashboard basic auth (HERMES_DASHBOARD_BASIC_AUTH_* on the Hermes side). */
	dashboardUsername: string
	dashboardPassword: string
}

const empty: Connection = {
	gatewayUrl: '',
	gatewayKey: '',
	dashboardUrl: '',
	dashboardToken: '',
	dashboardUsername: '',
	dashboardPassword: '',
}

const dataDir = process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data')
const file = join(dataDir, 'connection.json')

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

let current: Connection = load()

function load(): Connection {
	let saved: Partial<Connection> = {}
	if (existsSync(file)) {
		try {
			saved = JSON.parse(readFileSync(file, 'utf8'))
		} catch {}
	}
	return normalize({ ...empty, ...saved, ...fromEnv() })
}

function normalize(c: Connection): Connection {
	const trim = (u: string) => u.trim().replace(/\/+$/, '')
	return { ...c, gatewayUrl: trim(c.gatewayUrl), dashboardUrl: trim(c.dashboardUrl) }
}

export function getConnection(): Connection {
	return current
}

export function saveConnection(patch: Partial<Connection>) {
	// Secrets come back from the client redacted; keep the stored value unless replaced.
	const next = { ...current }
	for (const k of Object.keys(empty) as (keyof Connection)[]) {
		const v = patch[k]
		if (typeof v === 'string' && v !== REDACTED) next[k] = v
	}
	current = normalize({ ...next, ...fromEnv() })
	listeners.forEach((fn) => fn())
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify(current, null, 2), { mode: 0o600 })
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
