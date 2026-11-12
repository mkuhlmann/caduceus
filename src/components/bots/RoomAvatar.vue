<script setup lang="ts">
import { computed } from 'vue'
import BotAvatar from './BotAvatar.vue'
import { useBots } from '@/stores/bots'
import type { BotState } from '@/lib/avatar'
import type { RoomMember } from '@/stores/groups'

/** A group chat's face: up to three of its members' faces, overlapping. Busy members show it. */
const props = withDefaults(defineProps<{ members: RoomMember[]; size?: number; working?: string[]; alt?: string }>(), {
	size: 40,
	working: () => [],
})
const bots = useBots()
const shown = computed(() => props.members.slice(0, 3))
const each = computed(() => Math.round(props.size * (props.members.length > 1 ? 0.62 : 1)))
function state(m: RoomMember): BotState {
	return props.working.includes(m.member_id) ? 'working' : 'idle'
}
</script>

<template>
	<span
		class="relative inline-block shrink-0"
		:style="{ width: `${size}px`, height: `${size}px` }"
		role="img"
		:aria-label="alt ?? 'Group chat'"
	>
		<span
			v-for="(m, i) in shown"
			:key="m.member_id"
			class="absolute"
			:style="{
				left: `${shown.length === 1 ? 0 : i === 0 ? 0 : i === 1 ? size - each : (size - each) / 2}px`,
				top: `${shown.length === 1 ? 0 : i === 0 ? 0 : i === 1 ? (shown.length === 2 ? size - each : 0) : size - each}px`,
			}"
		>
			<BotAvatar
				:seed="m.profile"
				:look="bots.byName(m.profile)?.look"
				:image="bots.byName(m.profile)?.image"
				:state="state(m)"
				:size="each"
				:alt="bots.byName(m.profile)?.displayName ?? m.handle"
			/>
		</span>
	</span>
</template>
