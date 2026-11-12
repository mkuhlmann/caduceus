<script setup lang="ts">
import { useApp } from '@/stores/app'
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
			<option value="lapis">Lapis</option>
			<option value="graphite">Graphite</option>
		</select>
		<p class="mt-1 text-sm text-ink-2">
			Used whenever the theme is dark. Lapis is deep blue with gold, Graphite is warm charcoal with amber. Saved in this
			browser only.
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
