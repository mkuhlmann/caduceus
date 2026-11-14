import { afterAll, afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import { PreferencesPatchSchema } from '@/lib/preferences'
import { NotifyPatchSchema } from '@/lib/notifications'

const folder = () => mkdtempSync(join(tmpdir(), 'caduceus-store-'))
// Importing the store loads its data folder: never the developer's own.
const own = folder()
process.env.CADUCEUS_DATA_DIR = own
const { load, writeAtomic } = await import('../server/store')

const dirs: string[] = [own]
const fresh = () => {
	const d = folder()
	dirs.push(d)
	return d
}
afterEach(() => {
	for (const d of dirs.splice(1)) rmSync(d, { recursive: true, force: true })
})
afterAll(() => rmSync(own, { recursive: true, force: true }))

const read = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'))
const put = (dir: string, name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v))

test('an empty folder starts with every default', () => {
	const { config, state } = load(fresh())
	expect(config.preferences).toEqual({ voiceSubmit: 'fill', tintMessages: true, runStats: false })
	expect(config.notifications.events.reply).toBe(true)
	expect(config.connection.gatewayUrl).toBe('')
	expect(state).toMatchObject({ readMarks: { bots: {}, rooms: {} }, projects: [], bots: {}, push: { devices: [] } })
})

test('fields missing from a file get their defaults; fields no version knows are dropped', () => {
	const dir = fresh()
	put(dir, 'config.json', { preferences: { runStats: true, gone: 1 } })
	expect(load(dir).config.preferences).toEqual({ voiceSubmit: 'fill', tintMessages: true, runStats: true })
})

test('a file that does not fit stops the start and says where', () => {
	const dir = fresh()
	put(dir, 'config.json', { preferences: { voiceSubmit: 'shout' } })
	expect(() => load(dir)).toThrow(/config\.json does not fit at \/preferences\/voiceSubmit/)
	writeFileSync(join(dir, 'config.json'), '{ nope')
	expect(() => load(dir)).toThrow(/not valid JSON/)
})

test("older versions' files are moved into the two files, then deleted", () => {
	const dir = fresh()
	put(dir, 'preferences.json', { voiceSubmit: 'send', tintMessages: false, runStats: true })
	put(dir, 'read-marks.json', { bots: { ada: 5 }, rooms: {} })
	put(dir, 'bots.json', { ada: { key: 'k', updatedAt: 1 } })
	put(dir, 'notifications.json', {
		events: { waiting: true, reply: false, room: true, schedule: true },
		quietWhileActive: false,
		targets: [{ kind: 'webhook', url: 'https://x.test/h' }],
		appUrl: 'https://c.test/',
	})
	put(dir, 'vapid.json', { publicKey: 'p', privateJwk: { kty: 'EC' } })
	const { config, state } = load(dir)
	expect(config.preferences.voiceSubmit).toBe('send')
	expect(config.notifications).toEqual({
		events: { waiting: true, reply: false, room: true, schedule: true },
		quietWhileActive: false,
		channels: [{ kind: 'webhook', url: 'https://x.test/h' }],
	})
	expect(state.readMarks.bots).toEqual({ ada: 5 })
	expect(state.bots.ada?.key).toBe('k')
	expect(state.push).toMatchObject({ appUrl: 'https://c.test/', vapid: { publicKey: 'p' }, devices: [] })
	for (const f of ['preferences.json', 'read-marks.json', 'bots.json', 'notifications.json', 'vapid.json'])
		expect(existsSync(join(dir, f))).toBe(false)
	expect(read(dir, 'state.json').readMarks.bots).toEqual({ ada: 5 })
})

test('old files that do not fit stop the start and stay where they are', () => {
	const dir = fresh()
	put(dir, 'read-marks.json', { bots: { ada: 'yesterday' } })
	expect(() => load(dir)).toThrow(/old data does not fit/)
	expect(existsSync(join(dir, 'read-marks.json'))).toBe(true)
	expect(existsSync(join(dir, 'state.json'))).toBe(false)
})

test('a file is written whole and readable by its owner only', () => {
	const dir = fresh()
	writeAtomic(join(dir, 'state.json'), { version: 1 })
	expect(read(dir, 'state.json')).toEqual({ version: 1 })
	expect(statSync(join(dir, 'state.json')).mode & 0o777).toBe(0o600)
})

test('a change sent by a device is never filled with defaults, so it only changes what it names', () => {
	expect(Value.Default(PreferencesPatchSchema, { runStats: true })).toEqual({ runStats: true })
	expect(Value.Default(NotifyPatchSchema, { events: { reply: false } })).toEqual({ events: { reply: false } })
})
