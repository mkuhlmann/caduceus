<script setup lang="ts">
import { ref } from 'vue'
import { MoreHorizontal, Pin } from 'lucide-vue-next'
import BotAvatar from './BotAvatar.vue'
import BotMenu from './BotMenu.vue'
import { connectBot } from './connect'
import { STATE_LABELS } from '@/lib/avatar'
import { relative } from '@/lib/time'
import { useBots, type Bot } from '@/stores/bots'

/** One bot in the roster: face, name, handle, latest line or what it is doing, and its menu. */
const props = defineProps<{ bot: Bot }>()
const emit = defineEmits<{ settings: [] }>()
const bots = useBots()
const menu = ref(false)
const connecting = ref(false)

function lastLine() {
	const chat = bots.chats[props.bot.name]
	if (!props.bot.connected) return 'Not connected to Caduceus yet'
	// Still looking it up: keep the line empty rather than claim there is none.
	if (chat === undefined) return ' '
	if (!chat) return 'No conversation yet'
	const when = chat.last_active ?? chat.started_at
	return [chat.preview?.trim(), when ? relative(when) : ''].filter(Boolean).join(', ')
}

async function connect() {
	connecting.value = true
	await connectBot(props.bot)
	connecting.value = false
}

function onDragStart(e: DragEvent) {
	e.dataTransfer?.setData('application/x-caduceus-bot', props.bot.name)
	if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
	<li
		class="relative flex items-center gap-2 py-1"
		:class="{ 'opacity-55': bot.hidden }"
		draggable="true"
		@dragstart="onDragStart"
	>
		<RouterLink
			:to="`/bots/${encodeURIComponent(bot.name)}`"
			class="pressable flex min-w-0 flex-1 items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-surface-2"
			@click="bots.markSeen(bot.name)"
		>
			<BotAvatar
				:seed="bot.name"
				:look="bot.look"
				:image="bot.image"
				:state="bots.stateOf(bot.name).state"
				:hint="bots.stateOf(bot.name).hint"
				:alt="bot.displayName"
				:size="44"
			/>
			<div class="min-w-0 flex-1">
				<p class="flex min-w-0 items-baseline gap-2">
					<span class="truncate" :class="bots.unread(bot.name) ? 'font-bold' : 'font-semibold'">{{
						bot.displayName
					}}</span>
					<span class="truncate text-sm text-ink-3">@{{ bot.handle }}</span>
					<Pin v-if="bot.pinned" :size="13" class="shrink-0 self-center text-ink-3" aria-label="Pinned" />
				</p>
				<p class="truncate text-sm" :class="bots.unread(bot.name) ? 'text-ink-2' : 'text-ink-3'">
					<template v-if="bots.stateOf(bot.name).state !== 'idle'">
						{{ bots.stateOf(bot.name).hint ?? STATE_LABELS[bots.stateOf(bot.name).state] }}
					</template>
					<template v-else>{{ lastLine() }}</template>
				</p>
			</div>
			<span v-if="bots.unread(bot.name)" class="size-2 shrink-0 rounded-full bg-focus" aria-label="Unread" />
		</RouterLink>
		<button v-if="!bot.connected" class="btn-outline shrink-0" :disabled="connecting" @click="connect">Connect</button>
		<button
			class="icon-btn shrink-0"
			:aria-label="`${bot.displayName} actions`"
			:aria-expanded="menu"
			@click.stop="menu = !menu"
		>
			<MoreHorizontal :size="17" />
		</button>
		<BotMenu
			v-if="menu"
			:bot="bot"
			class="absolute top-12 right-0 z-20"
			@close="menu = false"
			@settings="emit('settings')"
		/>
	</li>
</template>
