<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Plus } from 'lucide-vue-next'
import BotAvatar from './BotAvatar.vue'
import RoomRow from './RoomRow.vue'
import { useBots, type Bot, type BotSection } from '@/stores/bots'
import { useGroups } from '@/stores/groups'

/** The roster beside a bot's chat: recognise each bot by its face, see at a glance which ones are busy. */
const props = defineProps<{ active?: string; activeRoom?: string }>()
const emit = defineEmits<{ navigate: [] }>()
const bots = useBots()
const groups = useGroups()
onMounted(() => {
	if (!groups.loaded) void groups.load()
	groups.listen()
})

// Hidden bots stay out, unless it is the one open right now.
const buckets = computed(() => {
	const visible = bots.bots.filter((b) => !b.hidden || b.name === props.active)
	const out: { section: BotSection | null; bots: Bot[] }[] = bots.sections
		.map((s) => ({ section: s as BotSection | null, bots: visible.filter((b) => b.sectionId === s.id) }))
		.filter((g) => g.bots.length)
	const rest = visible.filter((b) => !b.sectionId || !bots.sections.some((s) => s.id === b.sectionId))
	if (rest.length) out.push({ section: null, bots: rest })
	return out
})
</script>

<template>
	<aside class="flex h-full w-full flex-col bg-surface md:border-r md:border-line">
		<div class="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
			<RouterLink to="/bots" class="font-semibold hover:text-ink-2" @click="emit('navigate')">Bots</RouterLink>
			<RouterLink to="/bots?new=1" class="icon-btn" aria-label="New bot" @click="emit('navigate')">
				<Plus :size="18" />
			</RouterLink>
		</div>
		<nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Bots">
			<template v-for="g in buckets" :key="g.section?.id ?? 'none'">
				<p v-if="buckets.length > 1 || groups.rooms.length" class="px-2 pt-3 pb-1 text-xs font-medium text-ink-3">
					{{ g.section?.name ?? (bots.sections.length ? 'Unassigned' : 'Bots') }}
				</p>
				<RouterLink
					v-for="b in g.bots"
					:key="b.name"
					:to="`/bots/${encodeURIComponent(b.name)}`"
					class="pressable flex items-center gap-3 rounded-lg px-2 py-2"
					:class="[active === b.name ? 'bg-surface-2' : 'hover:bg-surface-2', { 'opacity-55': b.hidden }]"
					:aria-current="active === b.name ? 'page' : undefined"
					@click="emit('navigate')"
				>
					<BotAvatar
						:seed="b.name"
						:look="b.look"
						:image="b.image"
						:state="bots.stateOf(b.name).state"
						:hint="bots.stateOf(b.name).hint"
						:alt="b.displayName"
						:size="34"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm" :class="bots.unread(b.name) ? 'font-bold' : 'font-medium'">{{
							b.displayName
						}}</span>
						<span class="block truncate text-xs text-ink-3">{{
							bots.stateOf(b.name).hint ?? (b.connected ? `@${b.handle}` : 'Not connected')
						}}</span>
					</span>
					<span v-if="bots.unread(b.name)" class="size-2 shrink-0 rounded-full bg-focus" aria-label="Unread" />
				</RouterLink>
			</template>
			<template v-if="groups.rooms.length">
				<p class="px-2 pt-3 pb-1 text-xs font-medium text-ink-3">Group chats</p>
				<RoomRow
					v-for="r in groups.rooms"
					:key="r.room_id"
					:room="r"
					compact
					:active="r.room_id === activeRoom"
					@navigate="emit('navigate')"
				/>
			</template>
		</nav>
	</aside>
</template>
