<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
	MessageSquare,
	History,
	FolderKanban,
	CalendarClock,
	Webhook,
	SquareKanban,
	Sparkles,
	Settings,
	Sun,
	Moon,
	MonitorSmartphone,
} from 'lucide-vue-next'
import { useApp } from '@/stores/app'
import CaduceusMark from './CaduceusMark.vue'

const app = useApp()
const route = useRoute()

const items = [
	{ to: '/chat', label: 'Chat', icon: MessageSquare, match: 'chat' },
	{ to: '/history', label: 'History', icon: History, match: 'history' },
	{ to: '/projects', label: 'Projects', icon: FolderKanban, match: 'projects' },
	{ to: '/schedules', label: 'Schedules', icon: CalendarClock, match: 'schedules' },
	{ to: '/webhooks', label: 'Webhooks', icon: Webhook, match: 'webhooks' },
	{ to: '/board', label: 'Board', icon: SquareKanban, match: 'board' },
	{ to: '/skills', label: 'Skills', icon: Sparkles, match: 'skills' },
	{ to: '/settings', label: 'Settings', icon: Settings, match: 'settings' },
]

const themeIcon = computed(() => ({ system: MonitorSmartphone, light: Sun, dark: Moon })[app.theme])
const themeLabel = computed(() => ({ system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' })[app.theme])
function cycleTheme() {
	app.theme = app.theme === 'system' ? 'light' : app.theme === 'light' ? 'dark' : 'system'
}

const healthy = computed(() => app.gateway?.ok && (app.dashboard?.ok ?? true))
</script>

<template>
	<nav
		class="flex shrink-0 items-center gap-0.5 border-t border-line bg-surface px-2 py-1.5 md:w-[76px] md:flex-col md:overflow-visible md:border-t-0 md:border-r md:px-0 md:py-3"
		aria-label="Main"
	>
		<RouterLink to="/chat" class="mb-3 hidden size-10 text-ink md:block" aria-label="Caduceus home">
			<CaduceusMark />
		</RouterLink>
		<RouterLink
			v-for="item in items"
			:key="item.to"
			:to="item.to"
			class="group flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[0.6875rem] font-medium transition-colors md:w-[64px] md:flex-none md:px-1.5 md:py-1.5"
			:class="route.name === item.match ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:text-ink'"
			:aria-current="route.name === item.match ? 'page' : undefined"
			:title="item.label"
		>
			<component :is="item.icon" :size="19" :stroke-width="route.name === item.match ? 2.2 : 1.8" />
			<span class="sr-only md:not-sr-only">{{ item.label }}</span>
		</RouterLink>
		<div class="hidden flex-1 md:block" />
		<button class="icon-btn hidden md:inline-flex" :aria-label="themeLabel" :title="themeLabel" @click="cycleTheme">
			<component :is="themeIcon" :size="18" />
		</button>
		<RouterLink
			to="/connect"
			class="hidden items-center justify-center rounded-md p-2 md:flex"
			:title="healthy ? 'Connected to Hermes' : 'Connection needs attention'"
		>
			<span class="size-2.5 rounded-full" :class="healthy ? 'bg-verdigris' : 'bg-rose'" />
			<span class="sr-only">{{ healthy ? 'Connected to Hermes' : 'Connection needs attention' }}</span>
		</RouterLink>
	</nav>
</template>
