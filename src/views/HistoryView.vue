<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import HistoryRow, { type HistoryItem } from '@/components/history/HistoryRow.vue'
import { dashboard } from '@/lib/dashboard'
import { gateway } from '@/lib/gateway'
import { useApp } from '@/stores/app'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useToasts } from '@/stores/toast'

const PAGE = 50
const router = useRouter()
const app = useApp()
const sessions = useSessions()
const toasts = useToasts()

const query = ref('')
const source = ref('')
const archived = ref<'exclude' | 'include' | 'only'>('exclude')
const items = ref<HistoryItem[]>([])
const total = ref<number | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const busyId = ref('')
const stats = ref<{ total: number; messages: number; by_source: Record<string, number> } | null>(null)

const searching = computed(() => query.value.trim().length > 0)
const useDash = computed(() => app.hasDashboard())

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

let token = 0

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

async function run(more = false) {
	const my = ++token
	error.value = ''
	if (more) loadingMore.value = true
	else loading.value = true
	try {
		const q = query.value.trim()
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
			if (my !== token) return
			items.value = out
			total.value = out.length
			hasMore.value = false
		} else if (useDash.value) {
			const offset = more ? items.value.length : 0
			const r = await dashboard.sessions({
				order: 'recent',
				limit: PAGE,
				offset,
				archived: archived.value,
				...(source.value ? { source: source.value } : {}),
			})
			if (my !== token) return
			const rows = r.sessions.map(fromSession)
			items.value = more ? [...items.value, ...rows] : rows
			total.value = r.total
			hasMore.value = items.value.length < r.total
		} else {
			const offset = more ? items.value.length : 0
			const r = await gateway.sessions({
				limit: q ? 200 : PAGE,
				offset,
				...(source.value ? { source: source.value } : {}),
			})
			if (my !== token) return
			const needle = q.toLowerCase()
			const rows = r.data
				.filter((s) => !s.hidden && archivedOk(s.archived))
				.filter((s) => !needle || (s.title ?? '').toLowerCase().includes(needle))
				.map(fromSession)
			items.value = more ? [...items.value, ...rows] : rows
			total.value = null
			hasMore.value = !q && r.has_more
		}
	} catch (e) {
		if (my !== token) return
		error.value = (e as Error).message
	} finally {
		if (my === token) {
			loading.value = false
			loadingMore.value = false
		}
	}
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
	clearTimeout(timer)
	timer = setTimeout(() => run(), 250)
})
watch([source, archived], () => run())
onBeforeUnmount(() => clearTimeout(timer))

onMounted(async () => {
	run()
	if (useDash.value) {
		try {
			stats.value = (await dashboard.sessionStats()) as any
		} catch {
			/* the stats line is optional */
		}
	}
})

function open(id: string) {
	router.push(`/chat/${encodeURIComponent(id)}`)
}

async function toggleArchive(it: HistoryItem) {
	busyId.value = it.id
	try {
		const next = !it.archived
		await gateway.updateSession(it.id, { archived: next })
		toasts.push(next ? 'Chat archived' : 'Chat restored')
		const local = sessions.byId(it.id)
		if (local) local.archived = next
		if (archivedOk(next)) it.archived = next
		else items.value = items.value.filter((x) => x.id !== it.id)
	} catch (e) {
		toasts.error(`Could not ${it.archived ? 'restore' : 'archive'} this chat: ${(e as Error).message}`)
	} finally {
		busyId.value = ''
	}
}

async function remove(it: HistoryItem) {
	const name = it.title || it.preview?.trim() || 'Untitled'
	if (!confirm(`Delete "${name}"? The whole conversation is removed from Hermes and cannot be recovered.`)) return
	busyId.value = it.id
	try {
		await sessions.remove(it.id)
		items.value = items.value.filter((x) => x.id !== it.id)
		if (total.value != null) total.value--
		if (stats.value) stats.value.total--
		toasts.push('Chat deleted')
	} catch (e) {
		const err = e as Error & { status?: number }
		toasts.error(
			err.status === 409
				? 'This chat is working right now. Stop the run in the chat, then delete it.'
				: `Could not delete this chat: ${err.message}`,
		)
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
							class="rounded-full border px-2.5 py-0.5 text-sm transition-colors"
							:class="source === '' ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:bg-surface-2'"
							:aria-pressed="source === ''"
							@click="source = ''"
						>
							All
						</button>
						<button
							v-for="s in sources"
							:key="s.key"
							class="rounded-full border px-2.5 py-0.5 text-sm transition-colors"
							:class="source === s.key ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:bg-surface-2'"
							:aria-pressed="source === s.key"
							@click="source = source === s.key ? '' : s.key"
						>
							{{ s.label }} {{ s.n.toLocaleString() }}
						</button>
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

			<p v-if="loading && !items.length" class="mt-6 text-ink-3" role="status">Loading conversations</p>

			<EmptyState
				v-else-if="!items.length && !error"
				:title="searching ? 'No matches' : 'No conversations here yet'"
				:body="
					searching ? 'Try different words, or clear the channel filter.' : 'Start a chat and it will show up here.'
				"
			>
				<button v-if="!searching" class="btn-primary" @click="router.push('/chat')">New chat</button>
			</EmptyState>

			<template v-else-if="items.length">
				<p v-if="searching && !loading" class="mt-5 text-sm text-ink-3">
					{{ items.length }} {{ items.length === 1 ? 'conversation matches' : 'conversations match' }}
				</p>
				<ul class="mt-3 max-w-3xl divide-y divide-line border-y border-line" :class="{ 'opacity-60': loading }">
					<HistoryRow
						v-for="it in items"
						:key="it.id"
						:item="it"
						:busy="busyId === it.id"
						@open="open(it.id)"
						@archive="toggleArchive(it)"
						@remove="remove(it)"
					/>
				</ul>
				<div v-if="hasMore" class="mt-4 flex max-w-3xl items-center gap-3">
					<button class="btn-outline" :disabled="loadingMore" @click="run(true)">
						{{ loadingMore ? 'Loading' : 'Load more' }}
					</button>
					<span v-if="total != null" class="text-sm text-ink-3">Showing {{ items.length }} of {{ total }}</span>
				</div>
			</template>
		</div>
	</div>
</template>
