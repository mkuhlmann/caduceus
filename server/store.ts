import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isMainThread } from 'node:worker_threads'
import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { PreferencesSchema } from '../src/lib/preferences'
import { NotifySettingsSchema } from '../src/lib/notifications'
import { ReadMarksSchema } from '../src/lib/read-marks'

/**
 * What the relay remembers, in two files in its data folder (`CADUCEUS_DATA_DIR`, `./.data` by default), both
 * readable by their owner only:
 *
 * - `config.json`: what you set in the app. The connection, preferences, notification settings.
 * - `state.json`: what the app keeps for itself. Read marks, projects, bot keys, push devices and keys.
 *
 * Both are checked against their schema when the relay starts; one that does not fit stops it with what is wrong.
 * Modules change `config` or `state` in place and then call `saveConfig()` or `saveState()`.
 */

const ConnectionSchema = Type.Object(
	{
		gatewayUrl: Type.String({ default: '' }),
		gatewayKey: Type.String({ default: '' }),
		dashboardUrl: Type.String({ default: '' }),
		dashboardToken: Type.String({ default: '' }),
		/** Dashboard basic auth (HERMES_DASHBOARD_BASIC_AUTH_* on the Hermes side). */
		dashboardUsername: Type.String({ default: '' }),
		dashboardPassword: Type.String({ default: '' }),
	},
	{ default: {} },
)
export type Connection = Static<typeof ConnectionSchema>

export const ProjectSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.String({ default: '' }),
	instructions: Type.String({ default: '' }),
	color: Type.String({ default: 'lapis' }),
	sessionIds: Type.Array(Type.String(), { default: [] }),
	createdAt: Type.Number(),
	updatedAt: Type.Number(),
})
export type Project = Static<typeof ProjectSchema>

/** What Caduceus keeps per bot: the gateway key it set. */
const BotSchema = Type.Object({
	key: Type.Optional(Type.String()),
	updatedAt: Type.Number({ default: 0 }),
	// Kept here by older versions until moved into Hermes (`settle` in bots.ts).
	title: Type.Optional(Type.String()),
	look: Type.Optional(Type.Any()),
	image: Type.Optional(Type.String()),
})

export const SubscriptionSchema = Type.Object({
	endpoint: Type.String({ pattern: '^https://' }),
	keys: Type.Object({ p256dh: Type.String({ minLength: 1 }), auth: Type.String({ minLength: 1 }) }),
})
export const DeviceIdSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' })
const DeviceSchema = Type.Object({
	...SubscriptionSchema.properties,
	device: DeviceIdSchema,
	label: Type.String(),
	createdAt: Type.Number(),
})
export type Device = Static<typeof DeviceSchema>

const PushSchema = Type.Object(
	{
		/** Caduceus's address as the browser last reported it, for links in channel messages. */
		appUrl: Type.Optional(Type.String()),
		/** The relay's VAPID key pair, made on first use. */
		vapid: Type.Optional(Type.Object({ publicKey: Type.String(), privateJwk: Type.Record(Type.String(), Type.Any()) })),
		devices: Type.Array(DeviceSchema, { default: [] }),
	},
	{ default: {} },
)

const ConfigSchema = Type.Object({
	version: Type.Literal(1, { default: 1 }),
	connection: ConnectionSchema,
	preferences: PreferencesSchema,
	notifications: NotifySettingsSchema,
})
const StateSchema = Type.Object({
	version: Type.Literal(1, { default: 1 }),
	readMarks: ReadMarksSchema,
	projects: Type.Array(ProjectSchema, { default: [] }),
	bots: Type.Record(Type.String(), BotSchema, { default: {} }),
	push: PushSchema,
})
export type Config = Static<typeof ConfigSchema>
export type State = Static<typeof StateSchema>

/** A file's content with its defaults filled in, or an error saying where it does not fit. */
export function check<S extends TSchema>(schema: S, value: unknown, name: string): Static<S> {
	const v = Value.Default(schema, Value.Clean(schema, structuredClone(value ?? {})))
	if (Value.Check(schema, v)) return v as Static<S>
	const e = Value.Errors(schema, v).First()
	throw new Error(`${name} does not fit at ${e?.path || '/'}: ${e?.message}. Fix or remove it, then start again.`)
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (e) {
		throw new Error(`${path} is not valid JSON (${(e as Error).message}). Fix or remove it, then start again.`)
	}
}

/** Replace a file in one step (written aside, then renamed), so a crash never leaves half of one. */
export function writeAtomic(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
	renameSync(tmp, path)
}

/** The data files older versions kept. */
const OLD = {
	connection: 'connection.json',
	preferences: 'preferences.json',
	notifications: 'notifications.json',
	readMarks: 'read-marks.json',
	projects: 'projects.json',
	bots: 'bots.json',
	devices: 'push-devices.json',
	vapid: 'vapid.json',
}

/** What older versions' files say, as the content of the two new files; nothing when there are none. */
export function readOldFiles(dir: string): { config: unknown; state: unknown; files: string[] } | undefined {
	const files = Object.values(OLD)
		.map((f) => join(dir, f))
		.filter((f) => existsSync(f))
	if (!files.length) return undefined
	const old = (f: string): any => (existsSync(join(dir, f)) ? readJson(join(dir, f)) : undefined)
	const n = old(OLD.notifications)
	return {
		config: {
			connection: old(OLD.connection),
			preferences: old(OLD.preferences),
			notifications: n && { events: n.events, quietWhileActive: n.quietWhileActive, channels: n.targets },
		},
		state: {
			readMarks: old(OLD.readMarks),
			projects: old(OLD.projects),
			bots: old(OLD.bots),
			push: { appUrl: n?.appUrl, vapid: old(OLD.vapid), devices: old(OLD.devices) },
		},
		files,
	}
}

/** Read both files from a folder; older versions' files are moved into them first, then deleted. */
export function load(dir: string): { config: Config; state: State } {
	const configPath = join(dir, 'config.json')
	const statePath = join(dir, 'state.json')
	const old = !existsSync(configPath) && !existsSync(statePath) ? readOldFiles(dir) : undefined
	if (old) {
		writeAtomic(configPath, check(ConfigSchema, old.config, 'The old settings'))
		writeAtomic(statePath, check(StateSchema, old.state, 'The old data'))
		for (const f of old.files) rmSync(f, { force: true })
		console.log(`Moved ${old.files.length} old data files into config.json and state.json.`)
	}
	return {
		config: check(ConfigSchema, existsSync(configPath) ? readJson(configPath) : {}, 'config.json'),
		state: check(StateSchema, existsSync(statePath) ? readJson(statePath) : {}, 'state.json'),
	}
}

export const dataDir = process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data')

const loaded = (() => {
	try {
		return load(dataDir)
	} catch (e) {
		console.error(`Caduceus cannot start: ${(e as Error).message}`)
		process.exit(1)
	}
})()

export const config: Config = loaded.config
export const state: State = loaded.state

/** Write config.json now. */
export function saveConfig() {
	writeAtomic(join(dataDir, 'config.json'), config)
}

// State changes often (every read mark): what changes within a second is written once.
let stateTimer: ReturnType<typeof setTimeout> | undefined
export function saveState() {
	stateTimer ??= setTimeout(flushState, 1000)
}
function flushState() {
	if (!stateTimer) return
	clearTimeout(stateTimer)
	stateTimer = undefined
	writeAtomic(join(dataDir, 'state.json'), state)
}

// What waits to be written goes out before the relay stops.
process.on('exit', flushState)
if (isMainThread)
	for (const signal of ['SIGINT', 'SIGTERM'] as const)
		process.on(signal, () => {
			flushState()
			process.exit(0)
		})
