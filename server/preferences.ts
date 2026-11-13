import { Elysia } from 'elysia'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { broadcast } from './hermes-socket'

/**
 * Your preferences, kept on the Caduceus server so every device you open it on behaves the same. Settings that
 * belong to one screen (theme, colours) stay in the browser instead.
 */
export type Preferences = {
	/** What happens with a voice recording's text: put in the message box to check first, or sent right away. */
	voiceSubmit: 'fill' | 'send'
	/** In a bot's chat, your own messages and the send button take the bot's colour. */
	tintMessages: boolean
	/** A line under each reply with the model's speed and how long the turn took. */
	runStats: boolean
}

const defaults: Preferences = { voiceSubmit: 'fill', tintMessages: true, runStats: false }

const bool = (v: unknown): v is boolean => typeof v === 'boolean'

const valid: { [K in keyof Preferences]: (v: unknown) => v is Preferences[K] } = {
	voiceSubmit: (v): v is Preferences['voiceSubmit'] => v === 'fill' || v === 'send',
	tintMessages: bool,
	runStats: bool,
}

const file = join(process.env.CADUCEUS_DATA_DIR ?? join(process.cwd(), '.data'), 'preferences.json')

function load(): Preferences {
	const out = { ...defaults }
	if (!existsSync(file)) return out
	try {
		const saved = JSON.parse(readFileSync(file, 'utf8'))
		for (const k of Object.keys(valid) as (keyof Preferences)[]) if (valid[k](saved?.[k])) out[k] = saved[k]
	} catch {}
	return out
}

let prefs = load()

export const preferenceRoutes = new Elysia({ prefix: '/ui-api/preferences' })
	.get('/', () => prefs)
	.patch('/', ({ body, set }) => {
		const patch = (body ?? {}) as Record<string, unknown>
		const next: Record<string, unknown> = { ...prefs }
		for (const [k, v] of Object.entries(patch)) {
			const check = Object.hasOwn(valid, k) ? valid[k as keyof Preferences] : undefined
			if (!check) return ((set.status = 400), { error: `Unknown preference "${k}".` })
			if (!check(v)) return ((set.status = 400), { error: `${JSON.stringify(v)} is not a valid value for ${k}.` })
			next[k] = v
		}
		prefs = next as Preferences
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, JSON.stringify(prefs, null, 2))
		// Other devices take the change at once.
		broadcast('caduceus.preferences')
		return prefs
	})
