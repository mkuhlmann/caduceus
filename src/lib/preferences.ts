import { Type, type Static } from '@sinclair/typebox'
import { withoutDefaults } from './schema'

/**
 * Your preferences, kept on the Caduceus server (`server/preferences.ts`, in `config.json`) so every device you open
 * it on behaves the same. Settings that belong to one screen (theme, colours) stay in the browser instead.
 */
export const PreferencesSchema = Type.Object(
	{
		/** What happens with a voice recording's text: put in the message box to check first, or sent right away. */
		voiceSubmit: Type.Union([Type.Literal('fill'), Type.Literal('send')], {
			default: 'fill',
			error: 'voiceSubmit must be fill or send.',
		}),
		/** In a bot's chat, your own messages and the send button take the bot's colour. */
		tintMessages: Type.Boolean({ default: true }),
		/** A line under each reply with the model's speed and how long the turn took. */
		runStats: Type.Boolean({ default: false }),
		/**
		 * While a Bot Chat turn sent from Caduceus runs, the relay keeps the chat in view itself, so a question the bot
		 * asks waits for your answer even when no device shows the chat. Off, Hermes skips a question nobody can see.
		 */
		waitForAnswers: Type.Boolean({ default: false }),
	},
	{ additionalProperties: false, default: {} },
)
export type Preferences = Static<typeof PreferencesSchema>

/** A change to some of them. */
export const PreferencesPatchSchema = Type.Partial(withoutDefaults(PreferencesSchema), { additionalProperties: false })

export const defaultPreferences: Preferences = {
	voiceSubmit: 'fill',
	tintMessages: true,
	runStats: false,
	waitForAnswers: false,
}
