<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApp } from '@/stores/app'
import AppRail from '@/components/AppRail.vue'
import Toasts from '@/components/Toasts.vue'
import LoginView from '@/views/LoginView.vue'

const app = useApp()
const router = useRouter()

onMounted(async () => {
	try {
		await app.load()
	} catch {
		app.ready = true
	}
	if (app.connection && !app.gateway?.ok && !app.dashboard?.ok) router.replace('/connect')
})
</script>

<template>
	<div v-if="!app.ready" class="grid h-full place-items-center text-ink-3">
		<span class="sr-only">Connecting to Hermes</span>
	</div>
	<LoginView v-else-if="app.uiAuth?.required && !app.uiAuth.authenticated" />
	<div
		v-else
		class="flex h-full flex-col-reverse pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:flex-row md:pb-[env(safe-area-inset-bottom)]"
	>
		<AppRail />
		<main class="min-h-0 min-w-0 flex-1 overflow-hidden">
			<RouterView v-slot="{ Component }">
				<Transition name="page">
					<component :is="Component" :key="$route.name" />
				</Transition>
			</RouterView>
		</main>
	</div>
	<Toasts />
</template>
