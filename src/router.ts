import { createRouter, createWebHashHistory } from 'vue-router'

// Hash history so the same build works from file://, a webview wrapper, or a sub-path.
export const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{ path: '/', redirect: '/chat' },
		{ path: '/chat/:id?', name: 'chat', component: () => import('./views/ChatView.vue') },
		{ path: '/history', name: 'history', component: () => import('./views/HistoryView.vue') },
		{ path: '/projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
		{ path: '/schedules', name: 'schedules', component: () => import('./views/CronView.vue') },
		{ path: '/webhooks', name: 'webhooks', component: () => import('./views/WebhooksView.vue') },
		{ path: '/board', name: 'board', component: () => import('./views/KanbanView.vue') },
		{ path: '/skills', name: 'skills', component: () => import('./views/SkillsView.vue') },
		{ path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
		{ path: '/connect', name: 'connect', component: () => import('./views/ConnectView.vue') },
	],
})
