<script setup lang="ts">
import { ref } from 'vue'
import { useApp } from '@/stores/app'
import CaduceusMark from '@/components/CaduceusMark.vue'

const app = useApp()
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
	busy.value = true
	error.value = ''
	try {
		await app.login(password.value)
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<div class="grid h-full place-items-center px-6">
		<form class="w-full max-w-xs space-y-4" @submit.prevent="submit">
			<CaduceusMark class="size-12 text-ink" />
			<h1 class="display text-2xl">Sign in to Caduceus</h1>
			<div>
				<label class="label" for="pw">Password</label>
				<input id="pw" v-model="password" class="field" type="password" autofocus autocomplete="current-password" />
			</div>
			<p v-if="error" class="text-sm text-rose">{{ error }}</p>
			<button class="btn-primary w-full" :disabled="busy || !password">Sign in</button>
		</form>
	</div>
</template>
