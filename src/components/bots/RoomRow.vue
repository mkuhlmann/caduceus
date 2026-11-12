<script setup lang="ts">
import { computed } from 'vue'
import RoomAvatar from './RoomAvatar.vue'
import { relative } from '@/lib/time'
import { useBots } from '@/stores/bots'
import { useGroups, type Room } from '@/stores/groups'

/** One group chat in the roster: its members' faces, name, latest line, and whether it needs you. */
const props = defineProps<{ room: Room; compact?: boolean; active?: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
const groups = useGroups()
const bots = useBots()

const status = computed(() => groups.statusOf(props.room.room_id))
const workingIds = computed(() =>
	(status.value?.member_activity ?? []).filter((a) => a.status === 'running').map((a) => a.member_id),
)
const line = computed(() => {
	if (groups.needsYou(props.room.room_id)) return 'Needs you'
	if (workingIds.value.length) return 'Working'
	const last = groups.lastMessage(props.room.room_id)
	if (!last) return `${props.room.members.length} bots`
	const who =
		last.kind === 'message.user'
			? 'You'
			: (bots.byName(props.room.members.find((m) => m.member_id === last.payload.member_id)?.profile ?? '')
					?.displayName ?? last.payload.member_id)
	const text = String(last.payload.text ?? '').replace(/\s+/g, ' ')
	return props.compact ? `${who}: ${text}` : `${who}: ${text}${last.created_at ? `, ${relative(last.created_at)}` : ''}`
})
const unread = computed(() => groups.unread(props.room.room_id))
const needs = computed(() => groups.needsYou(props.room.room_id))
</script>

<template>
	<RouterLink
		:to="`/bots/rooms/${encodeURIComponent(room.room_id)}`"
		class="pressable flex min-w-0 items-center rounded-lg"
		:class="[compact ? 'gap-3 px-2 py-2' : 'gap-4 px-2 py-2.5', active ? 'bg-surface-2' : 'hover:bg-surface-2']"
		:aria-current="active ? 'page' : undefined"
		@click="(groups.markSeen(room.room_id), emit('navigate'))"
	>
		<RoomAvatar :members="room.members" :working="workingIds" :size="compact ? 34 : 44" :alt="room.name" />
		<span class="min-w-0 flex-1">
			<span
				class="block truncate"
				:class="[compact ? 'text-sm' : '', unread || needs ? 'font-bold' : compact ? 'font-medium' : 'font-semibold']"
				>{{ room.name }}</span
			>
			<span class="block truncate text-ink-3" :class="[compact ? 'text-xs' : 'text-sm', { 'text-ink-2': needs }]">{{
				line
			}}</span>
		</span>
		<span v-if="needs" class="chip shrink-0 bg-gold-soft text-ink">Needs you</span>
		<span v-else-if="unread" class="size-2 shrink-0 rounded-full bg-focus" aria-label="Unread" />
	</RouterLink>
</template>
