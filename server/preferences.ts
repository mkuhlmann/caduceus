import { Elysia } from 'elysia'
import { broadcast } from './hermes-socket'
import { config, saveConfig } from './store'
import { PreferencesPatchSchema } from '../src/lib/preferences'

/**
 * Your preferences, kept in `config.json` so every device you open Caduceus on behaves the same
 * (`src/lib/preferences.ts` has what they are).
 */
export const preferenceRoutes = new Elysia({ prefix: '/ui-api/preferences' })
	.get('/', () => config.preferences)
	.patch(
		'/',
		({ body }) => {
			config.preferences = { ...config.preferences, ...body }
			saveConfig()
			// Other devices take the change at once.
			broadcast('caduceus.preferences')
			return config.preferences
		},
		{ body: PreferencesPatchSchema },
	)
