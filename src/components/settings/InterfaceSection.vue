<script setup lang="ts">
import { useApp } from '@/stores/app'
import ToggleSwitch from './ToggleSwitch.vue'
const app = useApp()
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
			<ToggleSwitch v-model="app.tintMessages" label="Colour my messages in bot chats" />
			<span class="text-sm font-medium">Colour my messages in bot chats</span>
		</div>
		<p class="mt-1 text-sm text-ink-2">
			In a bot's chat, your messages and the send button take that bot's colour. Saved in this browser only.
		</p>

		<label class="label mt-6" for="ui-start">Start page</label>
		<select id="ui-start" v-model="app.startPage" class="field">
			<option value="chat">Chat</option>
			<option value="bots">Bots</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">
			Where Caduceus opens, here and when installed on a phone. Saved in this browser only.
		</p>
	</div>
</template>
