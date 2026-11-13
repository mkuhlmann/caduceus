<script setup lang="ts">
import { useApp } from '@/stores/app'
import { usePreferences, type Preferences } from '@/stores/preferences'
import { useToasts } from '@/stores/toast'
import ToggleSwitch from './ToggleSwitch.vue'
const app = useApp()
const preferences = usePreferences()
const toasts = useToasts()

async function setVoiceSubmit(v: Preferences['voiceSubmit']) {
	try {
		await preferences.set('voiceSubmit', v)
		toasts.push('Voice input saved')
	} catch (e) {
		toasts.error(`Could not save the voice setting. ${(e as Error).message}`)
	}
}

/** A switch shows its new state at once; only a refusal from the server is worth a toast. */
async function toggle(key: 'tintMessages' | 'runStats', v: boolean, what: string) {
	try {
		await preferences.set(key, v)
	} catch (e) {
		toasts.error(`Could not save ${what}. ${(e as Error).message}`)
	}
}
</script>

<template>
	<div class="max-w-xl">
		<label class="label" for="ui-theme">Theme</label>
		<select id="ui-theme" v-model="app.theme" class="field">
			<option value="system">Match my system</option>
			<option value="light">Light</option>
			<option value="dark">Dark</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">Saved in this browser only.</p>

		<label class="label mt-6" for="ui-dark-palette">Dark colours</label>
		<select id="ui-dark-palette" v-model="app.darkPalette" class="field">
			<option value="graphite">Graphite</option>
			<option value="lapis">Lapis</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">
			Used whenever the theme is dark. Graphite is warm charcoal with amber, Lapis is deep blue with gold. Saved in this
			browser only.
		</p>

		<div class="mt-6 flex items-center gap-3">
			<ToggleSwitch
				:model-value="preferences.prefs.tintMessages"
				label="Colour my messages in bot chats"
				@update:model-value="toggle('tintMessages', $event, 'the message colour setting')"
			/>
			<span class="text-sm font-medium">Colour my messages in bot chats</span>
		</div>
		<p class="mt-1 text-sm text-ink-2">
			In a bot's chat, your messages and the send button take that bot's colour. Saved on the Caduceus server, so it
			applies on all your devices.
		</p>

		<div class="mt-6 flex items-center gap-3">
			<ToggleSwitch
				:model-value="preferences.prefs.runStats"
				label="Show speed under replies"
				@update:model-value="toggle('runStats', $event, 'the speed setting')"
			/>
			<span class="text-sm font-medium">Show speed under replies</span>
		</div>
		<p class="mt-1 text-sm text-ink-2">
			After a reply, show how fast the model read the prompt (pp/s) and wrote its answer (tg/s), and how long the whole
			turn took. Saved on the Caduceus server, so it applies on all your devices.
		</p>

		<label class="label mt-6" for="ui-start">Start page</label>
		<select id="ui-start" v-model="app.startPage" class="field">
			<option value="chat">Chat</option>
			<option value="bots">Bots</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">
			Where Caduceus opens, here and when installed on a phone. Saved in this browser only.
		</p>

		<label class="label mt-6" for="ui-voice">After a voice recording</label>
		<select
			id="ui-voice"
			class="field"
			:value="preferences.prefs.voiceSubmit"
			@change="setVoiceSubmit(($event.target as HTMLSelectElement).value as Preferences['voiceSubmit'])"
		>
			<option value="fill">Put the text in the message box to check first</option>
			<option value="send">Send it right away</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">
			What happens when you finish recording with the microphone next to the send button. Hermes turns your voice into
			text with the provider set under Speech to text. Saved on the Caduceus server, so it applies on all your devices.
		</p>
	</div>
</template>
