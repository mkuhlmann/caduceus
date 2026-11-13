<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CornerDownRight, PanelLeft, Settings2, Square, X } from 'lucide-vue-next'
import BotSidebar from '@/components/bots/BotSidebar.vue'
import SessionSidebar from '@/components/chat/SessionSidebar.vue'
import ResizableSidebar from '@/components/ResizableSidebar.vue'
import BotAvatar from '@/components/bots/BotAvatar.vue'
import RoomAvatar from '@/components/bots/RoomAvatar.vue'
import RoomSettingsModal from '@/components/bots/RoomSettingsModal.vue'
import Composer, { type MentionBot } from '@/components/chat/Composer.vue'
import MarkdownBlocks from '@/components/chat/MarkdownBlocks.vue'
import MentionText from '@/components/chat/MentionText.vue'
import Skeleton from '@/components/Skeleton.vue'
import { dateTime, relative } from '@/lib/time'
import { useTitle } from '@/lib/title'
import { useBots } from '@/stores/bots'
import { useGroups, type PendingAction, type RoomEvent, type RoomMember } from '@/stores/groups'
import { useToasts } from '@/stores/toast'

/**
 * One group chat. Everything here is read from the room's log in Hermes: the user's and the members' messages in
 * order, plus the room's own notes (who it routed a message to, a pause, a failed turn). While members work, their
 * faces move and the room shows who is thinking; approvals are answered in place.
 */
const route = useRoute()
// Opened from the chat list (/chat/room/:roomId), the room keeps the chat list beside it instead of the roster.
const fromChats = computed(() => route.name === 'chat-room')
const bots = useBots()
const groups = useGroups()
const toasts = useToasts()

const roomId = computed(() => String(route.params.roomId ?? ''))
const room = computed(() => groups.open[roomId.value]?.state?.room ?? groups.byId(roomId.value))
const state = computed(() => groups.open[roomId.value]?.state ?? null)
const events = computed(() => groups.open[roomId.value]?.events ?? [])
const loadError = computed(() => groups.open[roomId.value]?.error ?? '')
const driver = computed(() => state.value?.driver_status ?? null)
const members = computed(() => room.value?.members ?? [])
const memberById = computed(() => new Map(members.value.map((m) => [m.member_id, m])))
const working = computed(() => (driver.value?.member_activity ?? []).filter((a) => a.status === 'running'))
const drawer = ref(false)
const settings = ref(false)
const replyThread = ref<{ id: string; excerpt: string } | null>(null)
const composer = ref<InstanceType<typeof Composer>>()
const scroller = ref<HTMLElement>()
const stopping = ref(false)
const continuing = ref('')

const needsYou = computed(() => groups.needsYou(roomId.value))
useTitle(() => (room.value ? (needsYou.value ? `Needs you – ${room.value.name}` : room.value.name) : 'Group chat'))

function bot(m?: RoomMember) {
	return m ? bots.byName(m.profile) : undefined
}
function nameOf(memberId?: string) {
	const m = memberById.value.get(memberId ?? '')
	return bot(m)?.displayName ?? m?.display_name ?? m?.handle ?? memberId ?? 'A member'
}

// Mentions offered in the composer: the members, then the room-wide tags.
const mentionTargets = computed<MentionBot[]>(() =>
	members.value.map((m) => {
		const b = bot(m)
		return {
			name: m.profile,
			handle: m.handle,
			title: b?.title ?? '',
			displayName: b?.displayName ?? m.display_name ?? m.handle,
			isDefault: m.profile === 'default',
			look: b?.look,
			image: b?.image,
		}
	}),
)
const extraMentions = [
	{ tag: 'all', label: 'Everyone in the room' },
	{ tag: 'everyone', label: 'Everyone in the room' },
]

// ── The transcript ─────────────────────────────────────────────────────────────────────────────────────────────
type Row =
	| { kind: 'user'; e: RoomEvent; thread?: string }
	| { kind: 'member'; e: RoomEvent; m?: RoomMember; thread?: string }
	| { kind: 'note'; e: RoomEvent; text: string; tone?: 'error' }
	| { kind: 'paused'; e: RoomEvent; count: number; actionable: boolean }

const threadRoots = computed(() => {
	const roots = new Map<string, RoomEvent>()
	for (const e of events.value)
		if (
			(e.kind === 'message.user' || e.kind === 'message.member') &&
			e.payload.thread_id &&
			!roots.has(e.payload.thread_id)
		)
			roots.set(e.payload.thread_id, e)
	return roots
})

function excerpt(e?: RoomEvent) {
	const t = String(e?.payload.text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
	return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

const REASONS: Record<string, string> = {
	turn_deadline_exceeded: 'took too long and was stopped',
	prepare_failed: 'could not start its turn',
}

const rows = computed<Row[]>(() => {
	const out: Row[] = []
	const all = events.value
	let lastThread = ''
	// Pauses that a later stop, continue or message in their thread made moot.
	const lastStop = all.reduce((s, e) => (e.kind === 'room.stop_requested' ? e.seq : s), 0)
	const continued = new Map<string, number>()
	for (const e of all)
		if (e.kind === 'room.continued' && e.payload.discussion_event_id)
			continued.set(e.payload.discussion_event_id, (continued.get(e.payload.discussion_event_id) ?? 0) + 1)
	let sincePause = 0
	for (const e of all) {
		const thread = e.payload.thread_id as string | undefined
		// A message continuing an earlier thread, after other talk, says which thread it belongs to.
		const threadLabel = (msgThread?: string) => {
			if (!msgThread) return undefined
			const root = threadRoots.value.get(msgThread)
			const label = root && root.seq !== e.seq && msgThread !== lastThread ? excerpt(root) : undefined
			lastThread = msgThread
			return label
		}
		switch (e.kind) {
			case 'message.user':
				out.push({ kind: 'user', e, thread: threadLabel(thread) })
				sincePause = 0
				break
			case 'message.member':
				out.push({
					kind: 'member',
					e,
					m: memberById.value.get(e.payload.member_id ?? e.actor?.id ?? ''),
					thread: threadLabel(thread),
				})
				sincePause++
				break
			case 'turn.failed': {
				const reason =
					REASONS[e.payload.reason_code] ?? String(e.payload.error ?? e.payload.reason ?? '').split('\n')[0]
				out.push({
					kind: 'note',
					e,
					text: `${nameOf(e.payload.member_id)} hit an error${reason ? ` — ${reason}` : ''}`,
					tone: 'error',
				})
				break
			}
			case 'member.unavailable':
				out.push({ kind: 'note', e, text: `${nameOf(e.payload.member_id)} is unavailable right now`, tone: 'error' })
				break
			case 'room.routed': {
				const ids: string[] = Array.isArray(e.payload.member_ids) ? e.payload.member_ids : []
				const text = e.payload.fallback
					? 'Could not pick who answers, so everyone does'
					: e.payload.everyone
						? 'Assigned to everyone'
						: ids.length
							? `Assigned to ${ids.map(nameOf).join(', ')}`
							: ''
				if (text) out.push({ kind: 'note', e, text })
				break
			}
			case 'room.activity':
				if (e.payload.status === 'bounded') {
					const discussion = String(e.payload.discussion_event_id ?? '')
					const laterUser = all.some(
						(x) => x.seq > e.seq && x.kind === 'message.user' && (!thread || x.payload.thread_id === thread),
					)
					const actionable =
						!!discussion &&
						lastStop < e.seq &&
						!laterUser &&
						!all.some(
							(x) => x.seq > e.seq && x.kind === 'room.continued' && x.payload.discussion_event_id === discussion,
						) &&
						(continued.get(discussion) ?? 0) < (driver.value?.max_continues ?? 5)
					out.push({ kind: 'paused', e, count: sincePause, actionable })
				} else if (REASONS[e.payload.reason_code]) out.push({ kind: 'note', e, text: REASONS[e.payload.reason_code]! })
				break
			case 'room.continued':
				out.push({ kind: 'note', e, text: 'Continued the discussion' })
				break
			case 'room.stop_requested':
				out.push({ kind: 'note', e, text: 'Stopped' })
				break
			case 'room.context_set':
				out.push({ kind: 'note', e, text: 'Room settings updated' })
				break
			case 'room.renamed':
				out.push({ kind: 'note', e, text: `Renamed to ${e.payload.name ?? room.value?.name ?? ''}` })
				break
			case 'room.assignment': {
				// The lead's pick, so the user can see (and correct) who it handed the message to.
				const lead = nameOf(e.payload.lead_member_id as string | undefined)
				const names = ((e.payload.member_ids as string[] | undefined) ?? []).map((id) => nameOf(id)).join(', ')
				out.push({
					kind: 'note',
					e,
					text: e.payload.fallback || !names ? `${lead} is taking this` : `${lead} gave this to ${names}`,
				})
				break
			}
		}
	}
	return out
})

const approvals = computed(() =>
	(driver.value?.pending_actions ?? []).filter((a) => a.kind === 'approval' || a.kind === 'retry'),
)
const CHOICES: Record<string, string> = {
	once: 'Allow once',
	session: 'Allow for this room',
	always: 'Always allow',
	deny: 'Deny',
}

// ── Loading, live updates, scrolling ──────────────────────────────────────────────────────────────────────────────
let poll: ReturnType<typeof setTimeout> | undefined
// Like Hermes Desktop: a 2 s poll, or a 15 s backstop when the backend pushes groups.changed for this room.
const POLL_MS = 2000
const BACKSTOP_MS = 15_000
function schedule() {
	clearTimeout(poll)
	const pushed = groups.open[roomId.value]?.state?.change_events === true
	poll = setTimeout(
		async () => {
			if (!document.hidden && roomId.value) await groups.refresh(roomId.value).catch(() => {})
			schedule()
		},
		pushed ? BACKSTOP_MS : POLL_MS,
	)
}

watch(
	roomId,
	async (id, old) => {
		if (old) groups.close(old)
		replyThread.value = null
		if (!id) return
		if (!bots.loaded) void bots.load()
		groups.listen()
		await groups.openRoom(id)
		scrollDown(true)
		schedule()
	},
	{ immediate: true },
)
onBeforeUnmount(() => {
	clearTimeout(poll)
	if (roomId.value) groups.close(roomId.value)
})

let stick = true
function onScroll() {
	const el = scroller.value
	if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}
function scrollDown(force = false) {
	nextTick(() => {
		const el = scroller.value
		if (el && (force || stick)) el.scrollTop = el.scrollHeight
	})
}
watch(
	() => [events.value.length, working.value.length, approvals.value.length],
	() => {
		scrollDown()
		if (!document.hidden) groups.markSeen(roomId.value)
	},
)
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
function onVisible() {
	if (!document.hidden && roomId.value) {
		groups.markSeen(roomId.value)
		void groups.refresh(roomId.value)
	}
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────────────────────
async function send(text: string) {
	if (!room.value) return
	try {
		await groups.send(roomId.value, text, replyThread.value?.id)
		replyThread.value = null
		stick = true
		scrollDown(true)
		schedule()
	} catch (e) {
		toasts.error(`Could not send the message: ${(e as Error).message}`)
		composer.value?.seed(text)
	}
}

async function stop() {
	stopping.value = true
	try {
		const r = await groups.stop(roomId.value)
		toasts.push(r.cancelled ? 'Stopped' : 'Nothing was running')
	} catch (e) {
		toasts.error(`Could not stop: ${(e as Error).message}`)
	} finally {
		stopping.value = false
	}
}

async function resume(e: RoomEvent) {
	continuing.value = String(e.payload.discussion_event_id)
	try {
		await groups.resume(roomId.value, continuing.value)
		schedule()
	} catch (err) {
		toasts.error(`Could not continue: ${(err as Error).message}`)
	} finally {
		continuing.value = ''
	}
}

async function answer(a: PendingAction, choice: string) {
	try {
		await groups.answer(roomId.value, a, choice)
	} catch (e) {
		toasts.error(`Could not send the decision: ${(e as Error).message}`)
	}
}

function replyTo(m?: RoomMember) {
	if (m) composer.value?.seed(`@${m.handle} `)
}
function replyInThread(e: RoomEvent) {
	const id = e.payload.thread_id as string | undefined
	if (!id) return
	replyThread.value = { id, excerpt: excerpt(threadRoots.value.get(id) ?? e) }
	composer.value?.focus()
}

const subtitle = computed(() => {
	if (approvals.value.length) return 'Waiting for your approval'
	if (working.value.length)
		return `${working.value.map((a) => nameOf(a.member_id)).join(', ')} ${working.value.length > 1 ? 'are' : 'is'} working`
	if (needsYou.value) return 'Needs you'
	const ctx = groups.open[roomId.value]?.state?.context
	const lead = ctx?.routing === 'lead' && ctx.lead_member_id ? ` · ${nameOf(ctx.lead_member_id)} leads` : ''
	return `${members.value.length} bots${lead}`
})
</script>

<template>
	<div class="flex h-full">
		<ResizableSidebar>
			<SessionSidebar v-if="fromChats" :active-room="roomId" />
			<BotSidebar v-else :active-room="roomId" />
		</ResizableSidebar>
		<Transition name="drawer">
			<div v-if="drawer" class="fixed inset-0 z-40 md:hidden">
				<div class="absolute inset-0 bg-black/40" @click="drawer = false" />
				<div
					class="drawer-panel absolute inset-y-0 left-0 w-[85%] max-w-xs bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
				>
					<SessionSidebar v-if="fromChats" :active-room="roomId" @navigate="drawer = false" />
					<BotSidebar v-else :active-room="roomId" @navigate="drawer = false" />
				</div>
			</div>
		</Transition>

		<section class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-6">
				<button class="icon-btn md:hidden" :aria-label="fromChats ? 'Show chats' : 'Show bots'" @click="drawer = true">
					<PanelLeft :size="18" />
				</button>
				<RoomAvatar
					v-if="room"
					:members="members"
					:working="working.map((a) => a.member_id)"
					:size="34"
					:alt="room.name"
				/>
				<div class="min-w-0 flex-1">
					<h1 class="truncate text-base font-semibold">{{ room?.name ?? 'Group chat' }}</h1>
					<p class="truncate text-xs" :class="needsYou || approvals.length ? 'text-ink-2' : 'text-ink-3'">
						{{ subtitle }}
					</p>
				</div>
				<button v-if="driver?.working" class="btn-outline h-8" :disabled="stopping" @click="stop">
					<Square :size="12" fill="currentColor" /> Stop
				</button>
				<button v-if="room" class="icon-btn" aria-label="Group settings" @click="settings = true">
					<Settings2 :size="17" />
				</button>
			</header>

			<div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" @scroll="onScroll">
				<div class="mx-auto max-w-4xl px-4 py-6 md:px-8">
					<p v-if="loadError && !events.length" class="max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm">
						Could not open this group chat. {{ loadError }}
					</p>
					<Skeleton v-else-if="!state" variant="lines" :count="6" label="Loading group chat" />
					<template v-else>
						<div v-if="!rows.length" class="flex flex-col items-start gap-3 py-10">
							<RoomAvatar :members="members" :size="56" />
							<h2 class="display text-2xl">{{ room?.name }}</h2>
							<p class="max-w-[60ch] text-ink-2">
								{{ state.context?.purpose || 'Start the conversation.' }} Your message starts up to three rounds: every
								bot answers or passes. @mention bots to address only them.
							</p>
						</div>
						<template v-for="r in rows" :key="r.e.seq">
							<div v-if="r.kind === 'user'" class="my-5 flex flex-col items-end">
								<p v-if="r.thread" class="mb-1 flex items-center gap-1 text-xs text-ink-3">
									<CornerDownRight :size="12" /> In thread: {{ r.thread }}
								</p>
								<div class="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5">
									<p class="whitespace-pre-wrap [overflow-wrap:anywhere]">
										<MentionText :text="String(r.e.payload.text ?? '')" :bots="mentionTargets" />
									</p>
								</div>
							</div>
							<div v-else-if="r.kind === 'member'" class="group my-5 flex gap-3">
								<BotAvatar
									:seed="r.m?.profile ?? 'member'"
									:look="bot(r.m)?.look"
									:image="bot(r.m)?.image"
									:size="28"
									still
									class="mt-0.5"
									:alt="nameOf(r.m?.member_id)"
								/>
								<div class="min-w-0 flex-1">
									<p v-if="r.thread" class="mb-1 flex items-center gap-1 text-xs text-ink-3">
										<CornerDownRight :size="12" /> In thread: {{ r.thread }}
									</p>
									<p class="relative mb-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
										<span class="font-semibold">{{ nameOf(r.m?.member_id) }}</span>
										<span class="text-ink-3">@{{ r.m?.handle }}</span>
										<time v-if="r.e.created_at" class="text-xs text-ink-3" :title="dateTime(r.e.created_at)">{{
											relative(r.e.created_at)
										}}</time>
										<span
											class="pointer-events-none absolute -top-0.5 right-0 flex gap-1 rounded-md bg-bg opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
										>
											<button class="btn-ghost h-6 px-2 text-xs" @click="replyTo(r.m)">
												Reply to @{{ r.m?.handle }}
											</button>
											<button class="btn-ghost h-6 px-2 text-xs" @click="replyInThread(r.e)">Reply in thread</button>
										</span>
									</p>
									<MarkdownBlocks class="prose-h" :source="String(r.e.payload.text ?? '')" />
								</div>
							</div>
							<div
								v-else-if="r.kind === 'paused'"
								class="my-4 flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
							>
								<span class="text-ink-2">Paused after {{ r.count }} {{ r.count === 1 ? 'message' : 'messages' }}</span>
								<template v-if="r.actionable">
									<button class="btn-outline h-7" :disabled="!!continuing" @click="resume(r.e)">Continue</button>
									<button class="btn-ghost h-7" :disabled="stopping" @click="stop">Stop</button>
								</template>
							</div>
							<p v-else class="my-2 text-center text-xs" :class="r.tone === 'error' ? 'text-rose' : 'text-ink-3'">
								{{ r.text }}
							</p>
						</template>

						<div
							v-for="a in approvals"
							:key="a.task_id + a.execution_generation"
							class="my-4 max-w-[72ch] rounded-lg border border-gold/50 bg-gold-soft/40 p-3"
						>
							<template v-if="a.kind === 'approval'">
								<p class="text-sm font-medium">
									{{ nameOf(a.member_id) }} wants to run a command that needs your approval
								</p>
								<p v-if="a.approval?.description" class="mt-0.5 text-sm text-ink-2">{{ a.approval.description }}</p>
								<pre
									v-if="a.approval?.command"
									class="mt-2 overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap"
									>{{ a.approval.command }}</pre>
								<div class="mt-3 flex flex-wrap gap-2">
									<button
										v-for="c in a.approval?.choices ?? ['once', 'deny']"
										:key="c"
										:class="c === 'deny' ? 'btn-danger' : c === 'once' ? 'btn-primary' : 'btn-outline'"
										@click="answer(a, c)"
									>
										{{ CHOICES[c] ?? c }}
									</button>
								</div>
							</template>
							<template v-else>
								<p class="text-sm">{{ nameOf(a.member_id) }}’s turn did not finish.</p>
								<button class="btn-outline mt-2" @click="answer(a, 'retry')">Retry</button>
							</template>
						</div>

						<div v-for="a in working" :key="a.member_id" class="my-4 flex items-center gap-3 text-sm text-ink-3">
							<BotAvatar
								:seed="memberById.get(a.member_id)?.profile ?? a.member_id"
								:look="bot(memberById.get(a.member_id))?.look"
								:image="bot(memberById.get(a.member_id))?.image"
								state="working"
								:size="28"
								:alt="nameOf(a.member_id)"
							/>
							{{ nameOf(a.member_id) }} is thinking
						</div>
					</template>
				</div>
			</div>

			<div class="mx-auto w-full max-w-4xl px-3 pb-3 md:px-8 md:pb-5">
				<div
					v-if="replyThread"
					class="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-ink-2"
				>
					<CornerDownRight :size="14" class="shrink-0" />
					<span class="min-w-0 flex-1 truncate">Replying in thread: {{ replyThread.excerpt }}</span>
					<button class="icon-btn size-6" aria-label="Stop replying in thread" @click="replyThread = null">
						<X :size="14" />
					</button>
				</div>
				<Composer
					ref="composer"
					:draft-key="`room:${roomId}`"
					:disabled="!state"
					:placeholder="room ? `Message ${room.name}` : 'Message the group'"
					:mentions="mentionTargets"
					:extra-mentions="extraMentions"
					no-images
					autofocus
					@send="send"
				/>
			</div>
		</section>

		<RoomSettingsModal
			v-if="settings && room"
			:room="room"
			:context="state?.context"
			:routing-modes="driver?.routing_modes"
			@close="settings = false"
		/>
	</div>
</template>
