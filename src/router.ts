import { createRouter, createWebHashHistory } from 'vue-router'
import { homePath } from './stores/app'
import { setRouteTitle } from './lib/title'

// Hash history so the same build works from file://, a webview wrapper, or a sub-path.
export const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{ path: '/', redirect: () => homePath() },
		{ path: '/chat/:id?', name: 'chat', component: () => import('./views/ChatView.vue'), meta: { title: 'Chat' } },
		{ path: '/bots', name: 'bots', component: () => import('./views/BotsView.vue'), meta: { title: 'Bots' } },
		{
			path: '/bots/rooms/:roomId',
			name: 'room',
			component: () => import('./views/RoomView.vue'),
			meta: { rail: 'bots', title: 'Group chat' },
		},
		// A bot's chat is the chat view with the bot roster beside it.
		{
			path: '/bots/:name',
			name: 'bot',
			component: () => import('./views/ChatView.vue'),
			meta: { rail: 'bots', title: 'Bots' },
		},
		{
			path: '/history',
			name: 'history',
			component: () => import('./views/HistoryView.vue'),
			meta: { title: 'History' },
		},
		{
			path: '/projects',
			name: 'projects',
			component: () => import('./views/ProjectsView.vue'),
			meta: { title: 'Projects' },
		},
		{
			path: '/schedules',
			name: 'schedules',
			component: () => import('./views/CronView.vue'),
			meta: { title: 'Schedules' },
		},
		{
			path: '/webhooks',
			name: 'webhooks',
			component: () => import('./views/WebhooksView.vue'),
			meta: { title: 'Webhooks' },
		},
		{ path: '/board', name: 'board', component: () => import('./views/KanbanView.vue'), meta: { title: 'Board' } },
		{ path: '/skills', name: 'skills', component: () => import('./views/SkillsView.vue'), meta: { title: 'Skills' } },
		{
			path: '/settings',
			name: 'settings',
			component: () => import('./views/SettingsView.vue'),
			meta: { title: 'Settings' },
		},
		{
			path: '/connect',
			name: 'connect',
			component: () => import('./views/ConnectView.vue'),
			meta: { title: 'Connection' },
		},
	],
})

router.afterEach((to) => setRouteTitle(to.meta.title as string | undefined))
