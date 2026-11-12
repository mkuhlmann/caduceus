<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, Plus } from 'lucide-vue-next'
import BotAvatar from '@/components/bots/BotAvatar.vue'
import RoomAvatar from '@/components/bots/RoomAvatar.vue'
import { STATE_LABELS } from '@/lib/avatar'
import { useBots, type Bot } from '@/stores/bots'
import { useGroups, type Room } from '@/stores/groups'

/**
 * The bots above the chat list, as an adaptive bento: a bot at work or waiting for you, and a group chat with
 * news, get a wide card with a status line; every other bot is a small tile. It stays put while the chats scroll,
 * so it is capped at three rows; the rest are one tap away under "All bots".
 */
const props = defineProps<{ filter?: string }>()
const emit = defineEmits<{ navigate: [] }>()
const bots = useBots()
const groups = useGroups()

onMounted(() => {
	if (!bots.loaded) void bots.load()
	if (!groups.loaded) void groups.load()
	groups.listen()
})

const OPEN_KEY = 'caduceus.chatBotsOpen'
const open = ref(localStorage.getItem(OPEN_KEY) !== '0')
watch(open, (v) => localStorage.setItem(OPEN_KEY, v ? '1' : '0'))

/** Grid cells across three columns, three rows high. */
const CELLS = 9

type Item =
	| { kind: 'bot'; key: string; bot: Bot; span: 1 | 2; line?: string; busy: boolean }
	| { kind: 'room'; key: string; room: Room; span: 1 | 3; line?: string; busy: boolean; working: string[] }

function roomWorking(r: Room) {
	return (groups.statusOf(r.room_id)?.member_activity ?? [])
		.filter((a) => a.status === 'running')
		.map((a) => a.member_id)
}

function roomLine(r: Room, working: string[]) {
	if (groups.needsYou(r.room_id)) return 'Needs you'
	if (working.length) {
		const names = working.map(
			(id) => bots.byName(r.members.find((m) => m.member_id === id)?.profile ?? '')?.displayName ?? id,
		)
		return `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} working`
	}
	const last = groups.lastMessage(r.room_id)
	if (!last) return undefined
	const who =
		last.kind === 'message.user'
			? 'You'
			: (bots.byName(r.members.find((m) => m.member_id === last.payload.member_id)?.profile ?? '')?.displayName ??
				last.payload.member_id)
	return `${who}: ${String(last.payload.text ?? '').replace(/\s+/g, ' ')}`
}

const matches = (q: string, ...texts: (string | undefined)[]) =>
	!q || texts.some((t) => (t ?? '').toLowerCase().includes(q))

const items = computed<Item[]>(() => {
	const q = (props.filter ?? '').trim().toLowerCase()
	const botItems: Item[] = bots.bots
		.filter((b) => !b.hidden && matches(q, b.displayName, b.handle, b.name))
		.map((b) => {
			const s = bots.stateOf(b.name)
			const busy = s.state !== 'idle' && s.state !== 'done'
			return {
				kind: 'bot',
				key: `b:${b.name}`,
				bot: b,
				span: busy ? 2 : 1,
				busy,
				line: s.hint ?? STATE_LABELS[s.state],
			}
		})
	const roomItems: Item[] = groups.rooms
		.filter((r) => matches(q, r.name))
		.map((r) => {
			const working = roomWorking(r)
			const news = working.length > 0 || groups.needsYou(r.room_id) || groups.unread(r.room_id)
			return {
				kind: 'room',
				key: `r:${r.room_id}`,
				room: r,
				span: news ? 3 : 1,
				busy: working.length > 0,
				working,
				line: roomLine(r, working),
			}
		})
	// Wide cards first, then unread bots; otherwise the roster's own order (pinned, Hermes, recent).
	const rank = (i: Item) =>
		i.span > 1 ? 0 : i.kind === 'bot' && bots.unread(i.bot.name) ? 1 : i.kind === 'bot' ? 2 : 3
	const all = [...botItems, ...roomItems].map((i, n) => ({ i, n })).sort((a, b) => rank(a.i) - rank(b.i) || a.n - b.n)
	const out: Item[] = []
	let used = 0
	for (const { i } of all) {
		if (used + i.span > CELLS) continue
		out.push(i)
		used += i.span
	}
	return out
})

const total = computed(() => bots.bots.filter((b) => !b.hidden).length + groups.rooms.length)
const shown = computed(() => total.value > 1 || groups.rooms.length > 0)
const more = computed(() => total.value - items.value.length)
// A free cell in the last row offers a new bot instead of a gap.
const spare = computed(() => !props.filter && items.value.reduce((n, i) => n + i.span, 0) % 3 !== 0)
</script>

<template>
	<section v-if="shown && (items.length || !filter)" class="border-b border-line px-3 pb-2.5" aria-label="Bots">
		<div class="flex items-center gap-1 px-1 pt-1 pb-1.5">
			<button
				class="flex items-center gap-1 rounded text-xs font-medium text-ink-3 hover:text-ink-2"
				:aria-expanded="open"
				@click="open = !open"
			>
				<ChevronDown :size="13" class="transition-transform" :class="{ '-rotate-90': !open }" />
				Bots
			</button>
			<RouterLink to="/bots" class="ml-auto text-xs text-ink-2 hover:text-ink" @click="emit('navigate')">
				{{ more > 0 ? `All bots (+${more})` : 'All bots' }} ›
			</RouterLink>
		</div>
		<div v-if="open" class="grid grid-flow-row-dense grid-cols-3 gap-1.5">
			<template v-for="it in items" :key="it.key">
				<RouterLink
					v-if="it.kind === 'bot'"
					:to="`/bots/${encodeURIComponent(it.bot.name)}`"
					class="pressable relative flex min-w-0 rounded-[10px] bg-surface-2 hover:bg-surface-3"
					:class="
						it.span === 2
							? 'col-span-2 items-center gap-2.5 p-2.5'
							: 'flex-col items-center justify-center gap-1 px-1 pt-2.5 pb-2'
					"
					:title="it.span === 1 ? `${it.bot.displayName} · @${it.bot.handle}` : undefined"
					@click="emit('navigate')"
				>
					<BotAvatar
						:seed="it.bot.name"
						:look="it.bot.look"
						:image="it.bot.image"
						:state="bots.stateOf(it.bot.name).state"
						:hint="bots.stateOf(it.bot.name).hint"
						:alt="it.bot.displayName"
						:size="it.span === 2 ? 34 : 30"
					/>
					<span v-if="it.span === 2" class="flex min-w-0 flex-col">
						<span class="truncate text-[0.8125rem] font-semibold">{{ it.bot.displayName }}</span>
						<span class="truncate text-xs text-gold">{{ it.line }}</span>
					</span>
					<span
						v-else
						class="max-w-full truncate text-xs"
						:class="bots.unread(it.bot.name) ? 'font-extrabold' : 'font-semibold'"
						>{{ it.bot.displayName }}</span
					>
					<span
						v-if="bots.unread(it.bot.name)"
						class="absolute top-1.5 right-1.5 size-2 rounded-full bg-focus"
						aria-label="Unread"
					/>
				</RouterLink>
				<RouterLink
					v-else
					:to="`/bots/rooms/${encodeURIComponent(it.room.room_id)}`"
					class="pressable relative flex min-w-0 rounded-[10px] bg-surface-2 hover:bg-surface-3"
					:class="
						it.span === 3
							? 'col-span-3 items-center gap-2.5 px-2.5 py-2'
							: 'flex-col items-center justify-center gap-1 px-1 pt-2.5 pb-2'
					"
					:title="it.span === 1 ? it.room.name : undefined"
					@click="(groups.markSeen(it.room.room_id), emit('navigate'))"
				>
					<RoomAvatar
						:members="it.room.members"
						:working="it.working"
						:size="it.span === 3 ? 32 : 30"
						:alt="it.room.name"
					/>
					<span v-if="it.span === 3" class="flex min-w-0 flex-1 flex-col">
						<span
							class="truncate text-[0.8125rem]"
							:class="groups.unread(it.room.room_id) ? 'font-extrabold' : 'font-semibold'"
							>{{ it.room.name }}</span
						>
						<span
							class="truncate text-xs"
							:class="it.busy ? 'text-gold' : groups.needsYou(it.room.room_id) ? 'text-ink-2' : 'text-ink-3'"
							>{{ it.line }}</span
						>
					</span>
					<span v-else class="max-w-full truncate text-xs font-semibold">{{ it.room.name }}</span>
					<span v-if="it.span === 3 && groups.needsYou(it.room.room_id)" class="chip shrink-0 bg-gold-soft text-ink"
						>Needs you</span
					>
					<span
						v-else-if="groups.unread(it.room.room_id)"
						class="size-2 shrink-0 rounded-full bg-focus"
						:class="{ 'absolute top-1.5 right-1.5': it.span === 1 }"
						aria-label="Unread"
					/>
				</RouterLink>
			</template>
			<RouterLink
				v-if="spare"
				to="/bots?new=1"
				class="pressable flex flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line px-1 pt-2.5 pb-2 text-ink-3 hover:border-ink-3 hover:text-ink-2"
				@click="emit('navigate')"
			>
				<Plus :size="18" class="my-1.5" />
				<span class="text-xs font-medium">New bot</span>
			</RouterLink>
		</div>
	</section>
</template>
