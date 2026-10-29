<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Search, Pin, MoreHorizontal } from 'lucide-vue-next'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useProjects, PROJECT_COLORS } from '@/stores/projects'
import { dayGroup } from '@/lib/time'
import type { Session } from '@/lib/gateway'
import SessionMenu from './SessionMenu.vue'

const props = defineProps<{ activeId?: string }>()
const emit = defineEmits<{ navigate: [] }>()
const sessions = useSessions()
const projects = useProjects()
const router = useRouter()
const filter = ref('')
const menuFor = ref<string | null>(null)

const groups = computed(() => {
	const q = filter.value.trim().toLowerCase()
	const rows = sessions.visible.filter(
		(s) => !q || (s.title ?? '').toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q),
	)
	const out: { label: string; items: Session[] }[] = []
	const pinned = rows.filter((s) => s.pinned)
	if (pinned.length) out.push({ label: 'Pinned', items: pinned })
	for (const s of rows.filter((s) => !s.pinned)) {
		const label = dayGroup(s.last_active ?? s.started_at)
		let g = out.find((x) => x.label === label)
		if (!g) out.push((g = { label, items: [] }))
		g.items.push(s)
	}
	return out
})

function title(s: Session) {
	return s.title || s.preview?.slice(0, 70) || 'New chat'
}

function open(id: string) {
	router.push(`/chat/${encodeURIComponent(id)}`)
	emit('navigate')
}

function newChat() {
	router.push('/chat')
	emit('navigate')
}
</script>

<template>
	<aside class="flex h-full w-full flex-col bg-surface md:w-72 md:border-r md:border-line">
		<div class="flex items-center gap-2 px-3 pt-4 pb-2">
			<button class="btn-primary flex-1 justify-start" @click="newChat"><Plus :size="16" /> New chat</button>
		</div>
		<div class="relative px-3 pb-2">
			<Search :size="15" class="pointer-events-none absolute top-2.5 left-5.5 text-ink-3" />
			<input v-model="filter" class="field pl-8" placeholder="Filter chats" aria-label="Filter chats" />
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
			<p v-if="sessions.listError" class="px-2 py-3 text-sm text-rose">{{ sessions.listError }}</p>
			<section v-for="g in groups" :key="g.label" class="mt-3">
				<h2 class="px-2 pb-1 text-xs font-medium text-ink-3">{{ g.label }}</h2>
				<ul>
					<li v-for="s in g.items" :key="s.id" class="group relative">
						<button
							class="flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors"
							:class="s.id === props.activeId ? 'bg-surface-2' : 'hover:bg-surface-2/60'"
							:aria-current="s.id === props.activeId ? 'true' : undefined"
							@click="open(s.id)"
						>
							<span class="flex items-center gap-1.5 pr-6 text-sm text-ink">
								<span
									v-if="sessions.live[s.id]"
									class="size-1.5 shrink-0 animate-pulse rounded-full bg-gold"
									title="Working"
								/>
								<span
									v-else-if="projects.forSession(s.id)"
									class="size-1.5 shrink-0 rounded-full"
									:style="{ background: PROJECT_COLORS[projects.forSession(s.id)!.color] }"
									:title="projects.forSession(s.id)!.name"
								/>
								<Pin v-if="s.pinned" :size="12" class="shrink-0 text-ink-3" />
								<span class="truncate">{{ title(s) }}</span>
							</span>
							<span v-if="s.source && s.source !== 'api_server'" class="text-xs text-ink-3">{{
								sourceLabel(s.source)
							}}</span>
						</button>
						<button
							class="icon-btn absolute top-1 right-1 size-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
							:aria-label="`Options for ${title(s)}`"
							@click.stop="menuFor = menuFor === s.id ? null : s.id"
						>
							<MoreHorizontal :size="16" />
						</button>
						<SessionMenu
							v-if="menuFor === s.id"
							:session="s"
							class="absolute top-8 right-1 z-20"
							@close="menuFor = null"
						/>
					</li>
				</ul>
			</section>
			<div class="mt-4 space-y-2 px-2">
				<button
					v-if="sessions.hasMore"
					class="btn-ghost w-full"
					:disabled="sessions.loadingList"
					@click="sessions.loadList(true)"
				>
					Load older chats
				</button>
				<label class="flex items-center gap-2 text-xs text-ink-3">
					<input
						type="checkbox"
						:checked="sessions.showScheduled"
						class="accent-[var(--gold)]"
						@change="sessions.setShowScheduled(($event.target as HTMLInputElement).checked)"
					/>
					Show runs from schedules
				</label>
			</div>
		</div>
	</aside>
</template>
