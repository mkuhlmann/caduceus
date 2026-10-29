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
	</div>
</template>
