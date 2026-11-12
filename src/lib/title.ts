import { onScopeDispose, ref, watchEffect, type MaybeRefOrGetter, toValue } from 'vue'

/**
 * The browser tab's title: "<page> – Caduceus". The route gives each page its name (`meta.title`); a view that
 * shows something more specific (a chat, a bot, a project) claims the title with `useTitle` for as long as it is
 * mounted. Views can overlap during a page transition, so claims form a stack and the newest one wins.
 */
const APP = 'Caduceus'
const routeTitle = ref('')
const claims = ref<{ id: number; text: string }[]>([])
let next = 0

watchEffect(() => {
	const page = claims.value.filter((c) => c.text).at(-1)?.text || routeTitle.value
	document.title = page ? `${page} – ${APP}` : APP
})

export function setRouteTitle(text: string | undefined) {
	routeTitle.value = text ?? ''
}

/** Title the tab after what this view shows; an empty value falls back to the page's name. */
export function useTitle(text: MaybeRefOrGetter<string | undefined | null>) {
	const id = next++
	claims.value = [...claims.value, { id, text: '' }]
	const stop = watchEffect(() => {
		const value = toValue(text)?.trim() ?? ''
		claims.value = claims.value.map((c) => (c.id === id ? { id, text: value } : c))
	})
	onScopeDispose(() => {
		stop()
		claims.value = claims.value.filter((c) => c.id !== id)
	})
}
