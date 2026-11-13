import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, patch } from '@/lib/http'

/** Preferences kept on the Caduceus server (`server/preferences.ts`), so they follow you to every device. */
export type Preferences = {
	voiceSubmit: 'fill' | 'send'
}

const defaults: Preferences = { voiceSubmit: 'fill' }
const KEY = 'caduceus.preferences'

export const usePreferences = defineStore('preferences', () => {
	// The last copy seen paints at once; the server's copy replaces it when it arrives.
	const prefs = ref<Preferences>({ ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') })

	function keep(p: Preferences) {
		prefs.value = { ...defaults, ...p }
		localStorage.setItem(KEY, JSON.stringify(prefs.value))
	}

	async function load() {
		keep(await get<Preferences>('ui-api/preferences'))
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
