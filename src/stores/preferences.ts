import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, patch } from '@/lib/http'

/** Preferences kept on the Caduceus server (`server/preferences.ts`), so they follow you to every device. */
export type Preferences = {
	voiceSubmit: 'fill' | 'send'
	tintMessages: boolean
	runStats: boolean
}

const defaults: Preferences = { voiceSubmit: 'fill', tintMessages: true, runStats: false }
const KEY = 'caduceus.preferences'

/** Settings this browser kept before they moved to the server, with how each stored value reads. */
const legacy: { [K in keyof Preferences]?: [key: string, read: (v: string) => Preferences[K]] } = {
	tintMessages: ['caduceus.tintMessages', (v) => v !== 'off'],
	runStats: ['caduceus.runStats', (v) => v === 'on'],
}

export const usePreferences = defineStore('preferences', () => {
	// The last copy seen paints at once; the server's copy replaces it when it arrives.
	const prefs = ref<Preferences>({ ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') })

	function keep(p: Preferences) {
		prefs.value = { ...defaults, ...p }
		localStorage.setItem(KEY, JSON.stringify(prefs.value))
	}

	async function load() {
		keep(await get<Preferences>('ui-api/preferences'))
		await adoptLegacy()
	}

	/**
	 * A choice this browser made before the setting moved to the server is carried over once, unless another device
	 * already changed it from the default.
	 */
	async function adoptLegacy() {
		const carry: Partial<Preferences> = {}
		for (const [k, [key, read]] of Object.entries(legacy) as [keyof Preferences, [string, (v: string) => any]][]) {
			const saved = localStorage.getItem(key)
			if (saved === null) continue
			const v = read(saved)
			if (prefs.value[k] === defaults[k] && v !== defaults[k]) (carry as any)[k] = v
		}
		if (Object.keys(carry).length) keep(await patch<Preferences>('ui-api/preferences', carry))
		for (const [key] of Object.values(legacy)) localStorage.removeItem(key)
	}

	/** Saves one preference; it shows at once and is put back if the server refuses it. */
	async function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
		const before = prefs.value
		prefs.value = { ...before, [key]: value }
		try {
			keep(await patch<Preferences>('ui-api/preferences', { [key]: value }))
		} catch (e) {
			prefs.value = before
			throw e
		}
	}

	// Another device may have changed something while this one was in the background.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') load().catch(() => {})
	})

	return { prefs, load, set }
})
