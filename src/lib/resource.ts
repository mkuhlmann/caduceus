import { onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { onResync } from './live'
import { onRpcEvent } from './rpc'

/**
 * Stale-while-revalidate data for views. The last result per key lives in memory for the whole session,
 * so going back to a page paints its data at once while a fresh copy loads in the background.
 *
 *   const { data, error, pending, reload } = useResource('schedules', () => gateway.jobs())
 *
 * - `pending` is true only while there is nothing to show yet: use it for the skeleton.
 * - `refreshing` is true while a background reload runs over data that is already on screen.
 * - `reload()` refetches (after a mutation); `mutate(fn)` edits the cached value in place for optimistic updates.
 * - A `null` key means "not ready": nothing loads and `data` stays undefined.
 * - While in use it loads again when the app comes back from being away (`onResync`), and on each change event
 *   named in `on` (e.g. `{ on: ['cron.changed'] }`).
 */

type Entry = { data: unknown; at: number }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

export function peekResource<T>(key: string): T | undefined {
	return cache.get(key)?.data as T | undefined
}

/** Drops cached data whose key starts with `prefix`, so the next visit loads fresh. */
export function invalidateResource(prefix: string) {
	for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

function fetchShared<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
	const running = inflight.get(key)
	if (running) return running as Promise<T>
	const p = fetcher()
		.then((data) => {
			cache.set(key, { data, at: Date.now() })
			return data
		})
		.finally(() => inflight.delete(key))
	inflight.set(key, p)
	return p
}

function same(a: unknown, b: unknown) {
	if (a === b) return true
	try {
		return JSON.stringify(a) === JSON.stringify(b)
	} catch {
		return false
	}
}

export type Resource<T> = {
	data: Ref<T | undefined>
	error: Ref<string>
	pending: Ref<boolean>
	refreshing: Ref<boolean>
	reload: () => Promise<void>
	mutate: (fn: (current: T | undefined) => T | undefined) => void
}

export function useResource<T>(
	key: MaybeRefOrGetter<string | null>,
	fetcher: () => Promise<T>,
	opts: { on?: string[] } = {},
): Resource<T> {
	const data = shallowRef<T | undefined>()
	const error = ref('')
	const pending = ref(false)
	const refreshing = ref(false)
	let current: string | null = null
	let alive = true
	const again = () => (current === null ? undefined : load(current))
	const offs = [onResync(again), ...(opts.on ?? []).map((type) => onRpcEvent(type, again))]
	onScopeDispose(() => {
		alive = false
		for (const off of offs) off()
	})

	async function load(k: string) {
		const hit = cache.get(k)
		if (hit) data.value = hit.data as T
		pending.value = !hit
		refreshing.value = !!hit
		try {
			const fresh = await fetchShared(k, fetcher)
			if (!alive || current !== k) return
			// An unchanged answer keeps the same object, so nothing on screen re-renders.
			if (!same(data.value, fresh)) data.value = fresh
			error.value = ''
		} catch (e) {
			if (!alive || current !== k) return
			error.value = (e as Error).message ?? String(e)
		} finally {
			if (alive && current === k) pending.value = refreshing.value = false
		}
	}

	watch(
		() => toValue(key),
		(k) => {
			current = k
			if (k === null) {
				data.value = undefined
				pending.value = refreshing.value = false
				return
			}
			load(k)
		},
		{ immediate: true },
	)

	return {
		data,
		error,
		pending,
		refreshing,
		reload: () => (current === null ? Promise.resolve() : load(current)),
		mutate(fn) {
			data.value = fn(data.value)
			if (current !== null) cache.set(current, { data: data.value, at: Date.now() })
		},
	}
}
