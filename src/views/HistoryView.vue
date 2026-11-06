<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'
import HistoryRow, { type HistoryItem } from '@/components/history/HistoryRow.vue'
import { dashboard } from '@/lib/dashboard'
import { gateway } from '@/lib/gateway'
import { invalidateResource, useResource } from '@/lib/resource'
import { useApp } from '@/stores/app'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useToasts } from '@/stores/toast'

const PAGE = 50
const router = useRouter()
const app = useApp()
const sessions = useSessions()
const toasts = useToasts()

type Page = { items: HistoryItem[]; total: number | null; hasMore: boolean }
type Stats = { total: number; messages: number; by_source: Record<string, number> }

const query = ref('')
const source = ref('')
const archived = ref<'exclude' | 'include' | 'only'>('exclude')
const loadingMore = ref(false)
const moreError = ref('')
const busyId = ref('')

// The search runs 250ms after the last keystroke; until then the current results stay on screen.
const settledQuery = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
	clearTimeout(timer)
	timer = setTimeout(() => (settledQuery.value = q.trim()), 250)
})
onBeforeUnmount(() => clearTimeout(timer))

const searching = computed(() => settledQuery.value.length > 0)
const useDash = computed(() => app.hasDashboard())

// Each filter combination is cached, so going back to History, or back to a filter, paints at once.
const key = computed(
	() => `history:${useDash.value ? 'dash' : 'gw'}:${archived.value}:${source.value}:${settledQuery.value}`,
)
const { data: page, error, pending, refreshing, reload, mutate } = useResource<Page>(key, () => fetchPage(0))
// A background refresh returns fresh objects for the same chats. Rows whose data did not change keep their old
// object, so Vue skips re-rendering them.
let known = new Map<string, HistoryItem>()
const items = computed(() => {
	const next = (page.value?.items ?? []).map((it) => {
		const old = known.get(it.id)
		return old && sameItem(old, it) ? old : it
	})
	known = new Map(next.map((it) => [it.id, it]))
	return next
})
function sameItem(a: HistoryItem, b: HistoryItem) {
	const ka = Object.keys(a) as (keyof HistoryItem)[]
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

// Mounting all rows at once blocks a phone for a few frames. The first screenful renders with the page, the rest
// follows in small batches over the next frames, below the fold.
const FIRST = 12
const BATCH = 8
const limit = ref(FIRST)
let frame = 0
function growRows() {
	cancelAnimationFrame(frame)
	if (limit.value >= items.value.length) return
	frame = requestAnimationFrame(() => {
		limit.value += BATCH
		growRows()
	})
}
watch(() => items.value.length, growRows, { immediate: true })
// New results for another search or filter replace most rows, so they mount in batches too.
watch(pending, (now, before) => {
	if (before && !now) {
		limit.value = FIRST
		growRows()
	}
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
const shownItems = computed(() => (limit.value >= items.value.length ? items.value : items.value.slice(0, limit.value)))
const total = computed(() => page.value?.total ?? null)
const hasMore = computed(() => !!page.value?.hasMore)
// Results from the previous filter stay visible, dimmed, while the new ones load.
const stale = computed(() => pending.value && !!page.value)

const {
	data: stats,
	pending: statsPending,
	mutate: mutateStats,
} = useResource<Stats>(
	() => (useDash.value ? 'history:stats' : null),
	() => dashboard.sessionStats() as Promise<Stats>,
)

const statsLine = computed(() => {
	const s = stats.value
	if (!s) return undefined
	const c = s.total === 1 ? 'conversation' : 'conversations'
	const m = s.messages === 1 ? 'message' : 'messages'
	return `${s.total.toLocaleString()} ${c}, ${s.messages.toLocaleString()} ${m}`
})

const sources = computed(() =>
	Object.entries(stats.value?.by_source ?? {})
		.sort((a, b) => b[1] - a[1])
		.map(([key, n]) => ({ key, n, label: sourceLabel(key) })),
)

function fromSession(s: any): HistoryItem {
	return {
		id: s.id,
		title: s.title,
		preview: s.preview,
		source: s.source,
		model: s.model,
		last_active: s.last_active ?? s.started_at,
		message_count: s.message_count,
		is_active: s.is_active,
		archived: !!s.archived,
	}
}

function archivedOk(a: boolean | undefined) {
	if (archived.value === 'only') return !!a
	if (archived.value === 'exclude') return !a
	return true
}

async function fetchPage(offset: number): Promise<Page> {
	const q = settledQuery.value
	if (useDash.value && q) {
		const hits = await dashboard.search(q, 60)
		const seen = new Set<string>()
		const out: HistoryItem[] = []
		for (const h of hits) {
			const id = h.session_id
			if (seen.has(id)) continue
			seen.add(id)
			const item = { ...fromSession({ ...h, id }), snippet: h.snippet }
			if (source.value && item.source !== source.value) continue
			if (!archivedOk(item.archived)) continue
			out.push(item)
		}
		return { items: out, total: out.length, hasMore: false }
	}
	if (useDash.value) {
		const r = await dashboard.sessions({
			order: 'recent',
			limit: PAGE,
			offset,
			archived: archived.value,
			...(source.value ? { source: source.value } : {}),
		})
		const rows = r.sessions.map(fromSession)
		return { items: rows, total: r.total, hasMore: offset + rows.length < r.total }
	}
	const r = await gateway.sessions({
		limit: q ? 200 : PAGE,
		offset,
		...(source.value ? { source: source.value } : {}),
	})
	const needle = q.toLowerCase()
	const rows = r.data
		.filter((s) => !s.hidden && archivedOk(s.archived))
		.filter((s) => !needle || (s.title ?? '').toLowerCase().includes(needle))
		.map(fromSession)
	return { items: rows, total: null, hasMore: !q && r.has_more }
}

async function loadMore() {
	const k = key.value
	loadingMore.value = true
	moreError.value = ''
	try {
		const next = await fetchPage(items.value.length)
		if (k !== key.value) return
		mutate((cur) => ({
			items: [...(cur?.items ?? []), ...next.items.filter((n) => !cur?.items.some((c) => c.id === n.id))],
			total: next.total,
			hasMore: next.hasMore,
		}))
	} catch (e) {
		moreError.value = (e as Error).message
	} finally {
		loadingMore.value = false
	}
}

// Rows only animate out right after the user archives or deletes one, never on the first paint or a filter.
const animate = ref(false)
let animateTimer: ReturnType<typeof setTimeout> | undefined
function animateNext() {
	animate.value = true
	clearTimeout(animateTimer)
	animateTimer = setTimeout(() => (animate.value = false), 600)
}
onBeforeUnmount(() => clearTimeout(animateTimer))

/** Changes the visible list at once; `null` drops the chat from it. */
function patchItem(id: string, change: Partial<HistoryItem> | null) {
	mutate((cur) => {
		if (!cur) return cur
		const dropped = change === null && cur.items.some((x) => x.id === id)
		return {
			...cur,
			items:
				change === null
					? cur.items.filter((x) => x.id !== id)
					: cur.items.map((x) => (x.id === id ? { ...x, ...change } : x)),
			total: cur.total != null && dropped ? cur.total - 1 : cur.total,
		}
	})
}

function open(id: string) {
	router.push(`/chat/${encodeURIComponent(id)}`)
}

async function toggleArchive(it: HistoryItem) {
	const next = !it.archived
	busyId.value = it.id
	animateNext()
	// Other filters list this chat differently now; they reload on their next visit.
	invalidateResource('history:dash:')
	invalidateResource('history:gw:')
	patchItem(it.id, archivedOk(next) ? { archived: next } : null)
	try {
		await gateway.updateSession(it.id, { archived: next })
		toasts.push(next ? 'Chat archived' : 'Chat restored')
		const local = sessions.byId(it.id)
		if (local) local.archived = next
	} catch (e) {
		toasts.error(`Could not ${it.archived ? 'restore' : 'archive'} this chat: ${(e as Error).message}`)
		reload()
	} finally {
		busyId.value = ''
	}
}

async function remove(it: HistoryItem) {
	const name = it.title || it.preview?.trim() || 'Untitled'
	if (!confirm(`Delete "${name}"? The whole conversation is removed from Hermes and cannot be recovered.`)) return
	busyId.value = it.id
	animateNext()
	invalidateResource('history:dash:')
	invalidateResource('history:gw:')
	patchItem(it.id, null)
	try {
		await sessions.remove(it.id)
		mutateStats((s) => (s ? { ...s, total: s.total - 1 } : s))
		toasts.push('Chat deleted')
	} catch (e) {
		const err = e as Error & { status?: number }
		toasts.error(
			err.status === 409
				? 'This chat is working right now. Stop the run in the chat, then delete it.'
				: `Could not delete this chat: ${err.message}`,
		)
		reload()
	} finally {
		busyId.value = ''
	}
}
</script>

<template>
	<div class="h-full overflow-y-auto">
		<PageHeader title="History" :subtitle="statsLine ?? 'Every conversation Hermes has had, across all channels.'" />

		<div class="px-6 pb-16 md:px-10">
			<div class="flex max-w-3xl flex-col gap-3">
				<div class="relative">
					<Search :size="16" class="pointer-events-none absolute top-2.5 left-2.5 text-ink-3" />
					<input
						v-model="query"
						type="search"
						class="field pl-8"
						:placeholder="useDash ? 'Search everything that was said' : 'Filter by title'"
						:aria-label="useDash ? 'Search conversations' : 'Filter conversations by title'"
					/>
				</div>

				<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div v-if="sources.length" class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by channel">
						<button
							class="pressable rounded-full border px-2.5 py-0.5 text-sm"
							:class="source === '' ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:bg-surface-2'"
							:aria-pressed="source === ''"
							@click="source = ''"
						>
							All
						</button>
						<button
							v-for="s in sources"
							:key="s.key"
							class="pressable rounded-full border px-2.5 py-0.5 text-sm"
							:class="source === s.key ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:bg-surface-2'"
							:aria-pressed="source === s.key"
							@click="source = source === s.key ? '' : s.key"
						>
							{{ s.label }} {{ s.n.toLocaleString() }}
						</button>
					</div>
					<!-- Holds the place of the channel filters on a first visit, so the list does not jump down. -->
					<div v-else-if="statsPending" class="skeleton flex flex-wrap gap-1.5" aria-hidden="true">
						<span
							v-for="w in [40, 88, 72, 80]"
							:key="w"
							class="skeleton-bar h-6.5"
							:style="{ width: `${w}px`, borderRadius: '999px' }"
						/>
					</div>
					<div class="ml-auto flex items-center gap-2">
						<label for="archived" class="text-sm text-ink-2">Archived chats</label>
						<select id="archived" v-model="archived" class="field h-8 w-auto">
							<option value="exclude">Hide</option>
							<option value="include">Show with the rest</option>
							<option value="only">Show only archived</option>
						</select>
					</div>
				</div>
			</div>

			<p v-if="error" class="mt-4 max-w-3xl text-sm text-rose" role="alert">
				Could not load conversations: {{ error }}. Check the connection in Settings and try again.
			</p>

			<Skeleton v-if="pending && !items.length" class="mt-3" :count="8" label="Loading conversations" />

			<EmptyState
				v-else-if="!items.length && !error && !stale"
				:title="searching ? 'No matches' : 'No conversations here yet'"
				:body="
					searching ? 'Try different words, or clear the channel filter.' : 'Start a chat and it will show up here.'
				"
			>
				<button v-if="!searching" class="btn-primary" @click="router.push('/chat')">New chat</button>
			</EmptyState>

			<template v-else-if="items.length">
				<p v-if="searching" class="mt-5 text-sm text-ink-3" :class="{ invisible: stale }">
					{{ items.length }} {{ items.length === 1 ? 'conversation matches' : 'conversations match' }}
				</p>
				<div class="relative mt-3 max-w-3xl">
					<div v-if="pending || refreshing" class="absolute inset-x-0 -top-px z-10" aria-hidden="true">
						<div class="refresh-bar" />
					</div>
					<p v-if="stale" class="sr-only" role="status">Loading conversations</p>
					<TransitionGroup
						tag="ul"
						class="relative divide-y divide-line border-y border-line transition-opacity duration-(--dur)"
						:class="{ 'opacity-60': stale }"
						:aria-busy="stale"
						:name="animate ? 'rise' : 'none'"
						:leave-active-class="animate ? 'rise-leave-active absolute inset-x-0' : undefined"
					>
						<HistoryRow
							v-for="it in shownItems"
							:key="it.id"
							:item="it"
							:busy="busyId === it.id"
							@open="open(it.id)"
							@archive="toggleArchive(it)"
							@remove="remove(it)"
						/>
					</TransitionGroup>
				</div>
				<p v-if="moreError" class="mt-4 max-w-3xl text-sm text-rose" role="alert">
					Could not load more conversations: {{ moreError }}. Check the connection in Settings and try again.
				</p>
				<div v-if="hasMore" class="mt-4 flex max-w-3xl items-center gap-3">
					<button class="btn-outline" :disabled="loadingMore || stale" @click="loadMore">
						{{ loadingMore ? 'Loading' : 'Load more' }}
					</button>
					<span v-if="total != null" class="text-sm text-ink-3">Showing {{ items.length }} of {{ total }}</span>
				</div>
			</template>
		</div>
	</div>
</template>
