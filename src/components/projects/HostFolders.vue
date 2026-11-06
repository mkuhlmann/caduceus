<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import { dashboard } from '@/lib/dashboard'
import { useResource } from '@/lib/resource'
import { relative, dateTime } from '@/lib/time'

type Folder = {
	id: string
	label: string
	path: string | null
	sessionCount: number
	lastActive?: number | null
	previewSessions?: { id: string; title?: string | null; preview?: string; last_active?: number }[]
}

const router = useRouter()
const open = ref<Record<string, boolean>>({})
const { data, error, pending } = useResource('host-folders', async () =>
	((await dashboard.projectsTree()).projects as Folder[]).filter((f) => f.sessionCount > 0),
)
const folders = computed(() => data.value ?? [])
</script>

<template>
	<section class="mt-12 max-w-3xl">
		<h2 class="text-lg">Folders on the Hermes host</h2>
		<p class="mt-1 text-sm text-ink-2">
			These are Hermes' own working folders, and chats you start in the terminal there show up here.
		</p>
		<Skeleton v-if="pending" class="mt-3" :count="3" label="Loading folders" />
		<p v-else-if="error && !data" class="mt-3 text-sm text-rose" role="alert">
			Could not load the folders: {{ error }}
		</p>
		<p v-else-if="!folders.length" class="mt-3 text-sm text-ink-2">No chats have been started in a folder yet.</p>
		<ul v-else class="mt-3 divide-y divide-line border-y border-line">
			<li v-for="f in folders" :key="f.id">
				<button
					class="pressable flex w-full items-center gap-2 px-2 py-2.5 text-left hover:bg-surface-2/50"
					:aria-expanded="!!open[f.id]"
					@click="open[f.id] = !open[f.id]"
				>
					<ChevronRight
						:size="16"
						class="shrink-0 text-ink-3 transition-transform"
						:class="{ 'rotate-90': open[f.id] }"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium text-ink">{{ f.label }}</span>
						<span v-if="f.path" class="block truncate font-mono text-xs text-ink-3">{{ f.path }}</span>
					</span>
					<span class="shrink-0 text-right text-xs text-ink-3">
						<span class="block">{{ f.sessionCount }} {{ f.sessionCount === 1 ? 'chat' : 'chats' }}</span>
						<time v-if="f.lastActive" :title="dateTime(f.lastActive)">{{ relative(f.lastActive) }}</time>
					</span>
				</button>
				<Transition enter-active-class="rise-enter-active" enter-from-class="rise-enter-from">
					<ul v-if="open[f.id]" class="mb-2 ml-8 border-l border-line pl-3">
						<li v-for="s in f.previewSessions ?? []" :key="s.id">
							<button
								class="pressable flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-2/60"
								@click="router.push(`/chat/${encodeURIComponent(s.id)}`)"
							>
								<span class="truncate text-sm text-ink">{{ s.title || s.preview?.slice(0, 70) || 'Untitled' }}</span>
								<time v-if="s.last_active" class="shrink-0 text-xs text-ink-3" :title="dateTime(s.last_active)">{{
									relative(s.last_active)
								}}</time>
							</button>
						</li>
						<li v-if="f.sessionCount > (f.previewSessions?.length ?? 0)" class="px-2 py-1 text-xs text-ink-3">
							Showing the latest {{ f.previewSessions?.length ?? 0 }} of {{ f.sessionCount }}. Find the rest in History.
						</li>
					</ul>
				</Transition>
			</li>
		</ul>
	</section>
</template>
