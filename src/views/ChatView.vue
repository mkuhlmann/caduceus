<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PanelLeft, GitFork, Settings2, CalendarClock } from 'lucide-vue-next'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useBots } from '@/stores/bots'
import { useProjects, PROJECT_COLORS } from '@/stores/projects'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import { dashboard } from '@/lib/dashboard'
import { setSessionProfile } from '@/lib/gateway'
import { dateTime } from '@/lib/time'
import { useTitle } from '@/lib/title'
import SessionSidebar from '@/components/chat/SessionSidebar.vue'
import AgentTurnView from '@/components/chat/AgentTurnView.vue'
import Composer from '@/components/chat/Composer.vue'
import BotSidebar from '@/components/bots/BotSidebar.vue'
import BotAvatar from '@/components/bots/BotAvatar.vue'
import BotSettingsModal from '@/components/bots/BotSettingsModal.vue'
import RoutinesPanel from '@/components/bots/RoutinesPanel.vue'
import MentionText from '@/components/chat/MentionText.vue'
import { mentionNote, parseBotNotice, parseSystemNotice, resolveMentions, stripMentionNote } from '@/lib/mentions'
import { STATE_LABELS } from '@/lib/avatar'
import { connectBot } from '@/components/bots/connect'

const route = useRoute()
const router = useRouter()
const sessions = useSessions()
const projects = useProjects()
const app = useApp()
const toasts = useToasts()
const bots = useBots()

// On /bots/:name this is a bot's chat: its one `Bot Chat`, with the bot roster beside it.
const botName = computed(() => (route.params.name as string | undefined) || undefined)
// Opened from the chat list (/chat/bot/:name), the bot's chat keeps the chat list beside it instead of the roster.
const fromChats = computed(() => route.name === 'chat-bot')
const botBase = computed(() => (fromChats.value ? '/chat/bot' : '/bots'))
const bot = computed(() => (botName.value ? bots.byName(botName.value) : undefined))
const botState = computed(() => (botName.value ? bots.stateOf(botName.value) : { state: 'idle' as const }))
const editingBot = ref(false)
// The routines pane docks beside a bot's chat; it stays open across bots until closed.
const routinesOpen = ref(localStorage.getItem('caduceus.routinesOpen') === '1')
watch(routinesOpen, (v) => localStorage.setItem('caduceus.routinesOpen', v ? '1' : '0'))
// "Open recent session" shows another conversation of the bot (a routine run, a side thread) in its place.
const botSession = computed(() =>
	botName.value ? (route.query.session as string | undefined) || undefined : undefined,
)
// Registered before anything loads it, so its requests go to the bot's gateway path.
watch([botName, botSession], ([name, s]) => name && s && setSessionProfile(s, name), { immediate: true, flush: 'sync' })
const id = computed(() =>
	botName.value
		? (botSession.value ?? bots.chatId(botName.value))
		: (route.params.id as string | undefined) || undefined,
)
const session = computed(() => (id.value ? sessions.byId(id.value) : undefined))
const project = computed(() =>
	id.value ? projects.forSession(id.value) : projects.items.find((p) => p.id === route.query.project),
)
const turns = computed(() => (id.value ? sessions.turnsFor(id.value) : []))
// Long chats open with their latest turns; earlier ones are added as the reader scrolls up.
const PAGE = 30
const limit = ref(PAGE)
const shownTurns = computed(() => (turns.value.length > limit.value ? turns.value.slice(-limit.value) : turns.value))
const earlier = computed(() => turns.value.length - shownTurns.value.length)
// Older messages still on the server, loaded once the reader scrolls past everything held.
const olderOnServer = computed(() => !!id.value && sessions.hasOlder(id.value))
const loadingOlder = computed(() => !!id.value && sessions.isLoadingOlder(id.value))
// Turns added to the open chat (a reply, a run elsewhere) extend the window instead of pushing old ones out.
watch([id, () => turns.value.length], ([v, n], [was, before]) => {
	if (v === was && before && n > before) limit.value += n - before
})
const live = computed(() => (id.value ? sessions.live[id.value] : undefined))
const remote = computed(() => (id.value && !live.value ? sessions.remote[id.value] : undefined))
// A run in another tab or device can be stopped and steered from here; one in another channel only watched.
const running = computed(() => !!live.value || !!remote.value?.runId)
const liveStatus = computed(
	() => live.value?.status ?? (remote.value && !remote.value.runId ? 'Working in another channel' : undefined),
)
// Turn-shaped placeholders only while a chat that is not in memory yet loads.
const skeleton = computed(() => !!id.value && !turns.value.length && sessions.isLoading(id.value))
// Fade the conversation in when it replaces the placeholder; a chat that is already in memory just appears.
const fadeIn = ref(false)
watch(skeleton, (v) => v && (fadeIn.value = true))
const lastError = computed(() => (id.value ? sessions.lastError[id.value] : undefined))
// A chat painted from memory or disk while its fresh copy loads, and one whose fresh copy did not come.
const refreshing = computed(() => !!id.value && !live.value && sessions.isRefreshing(id.value))
const refreshError = computed(() => (id.value && !refreshing.value ? sessions.refreshError[id.value] : undefined))
function retryRefresh() {
	if (id.value) void sessions.loadMessages(id.value, { open: true })
}
const foreign = computed(
	() => !botName.value && session.value?.source && !['api_server'].includes(session.value.source),
)
// The face beside a reply is alive only on the newest one; earlier replies show it still.
const lastAgentKey = computed(() => [...shownTurns.value].reverse().find((t) => t.kind === 'agent')?.key)

const scroller = ref<HTMLElement>()
const content = ref<HTMLElement>()
const composer = ref<InstanceType<typeof Composer>>()
const drawer = ref(false)
const model = ref('')
const creating = ref(false)
let stickToBottom = true

onMounted(async () => {
	sessions.ensureList()
	if (!projects.loaded) projects.load().catch(() => {})
	if (app.dashboard?.ok)
		dashboard
			.modelInfo()
			.then((m) => (model.value = m.model))
			.catch(() => {})
})

watch(
	id,
	async (v) => {
		drawer.value = false
		fadeIn.value = false
		limit.value = PAGE
		sessions.follow(undefined)
		// A chat already in memory shows at once, at its end; a fresh copy loads behind it.
		stickToBottom = true
		scrollDown(true)
		nextTick(() => composer.value?.focus())
		if (v && !sessions.live[v]) await sessions.loadMessages(v, { open: true })
		if (v !== id.value) return
		sessions.follow(v)
		scrollDown()
	},
	{ immediate: true },
)

watch(
	botName,
	async (name) => {
		if (!name) return
		if (!bots.loaded) await bots.load()
		const b = bots.byName(name)
		if (b?.connected && bots.chats[name] === undefined) await bots.findChat(name)
	},
	{ immediate: true },
)
// Whatever the open bot writes while you look at it counts as read.
watch(
	[botName, () => (botName.value ? bots.chats[botName.value]?.last_active : 0), () => turns.value.length],
	([name]) => name && !document.hidden && bots.markSeen(name),
	{ immediate: true },
)

onUnmounted(() => {
	sessions.follow(undefined)
	grow.disconnect()
	nearTop?.disconnect()
})

// Autoscroll: while the reader is at the bottom, any growth of the conversation (streamed text, tool
// output, images loading, a run in another tab) keeps it there. Scrolling up stops it; scrolling back
// to the bottom resumes it.
let lastTop = 0
function onScroll() {
	const el = scroller.value
	if (!el) return
	if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stickToBottom = true
	else if (el.scrollTop < lastTop) stickToBottom = false
	lastTop = el.scrollTop
}
function scrollDown(force = false) {
	nextTick(() => {
		const el = scroller.value
		if (el && (force || stickToBottom)) el.scrollTop = el.scrollHeight
	})
}
const grow = new ResizeObserver(() => scrollDown())

/** Add earlier turns above, keeping the reader's place: held ones first, then a page from the server. */
async function showEarlier() {
	const el = scroller.value
	const chat = id.value
	if (!el || !chat || (!earlier.value && !olderOnServer.value)) return
	const fromBottom = el.scrollHeight - el.scrollTop
	// Loaded turns land above and widen the window by themselves (the watch on the turn count).
	if (earlier.value) limit.value += PAGE
	else await sessions.loadOlder(chat)
	if (chat !== id.value) return
	nextTick(() => {
		el.scrollTop = el.scrollHeight - fromBottom
		// Still near the top (a short page of turns): observe again so it keeps filling.
		if (sentinel.value && nearTop) {
			nearTop.unobserve(sentinel.value)
			nearTop.observe(sentinel.value)
		}
	})
}
const sentinel = ref<HTMLElement>()
let nearTop: IntersectionObserver | undefined
watch(sentinel, (el, old) => {
	if (!nearTop && scroller.value)
		nearTop = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && showEarlier(), {
			root: scroller.value,
			rootMargin: '800px 0px 0px 0px',
		})
	if (old) nearTop?.unobserve(old)
	if (el) nearTop?.observe(el)
})
onMounted(() => scroller.value && grow.observe(scroller.value))
watch(content, (el, old) => {
	if (old) grow.unobserve(old)
	if (el) grow.observe(el)
})

async function send(text: string, images: string[]) {
	// A Bot Chat is one forever-conversation: /new would fork it, so it compacts instead (as in Hermes Desktop).
	if (botName.value && !botSession.value && /^\/(new|reset)\s*$/.test(text.trim()) && !images.length) {
		if (!id.value) return
		toasts.push('Bot chats never reset. Compacting this one instead.')
		creating.value = true
		try {
			const r = await bots.compact(botName.value)
			toasts.push(
				r?.compressed === false
					? r.message || 'Nothing to compact yet.'
					: `Chat compacted${r?.removed ? `, ${r.removed} messages folded` : ''}`,
			)
		} catch (e) {
			toasts.error(`Could not compact the chat: ${(e as Error).message}`)
		} finally {
			creating.value = false
		}
		return
	}
	let target = id.value
	if (!target && botName.value) {
		creating.value = true
		try {
			target = await bots.ensureChat(botName.value)
		} catch (e) {
			toasts.error(`Could not start a chat with this bot: ${(e as Error).message}`)
			return
		} finally {
			creating.value = false
		}
	}
	if (!target) {
		creating.value = true
		try {
			const s = await sessions.create({
				projectId: project.value?.id,
				instructions: project.value?.instructions || undefined,
			})
			target = s.id
			await router.push(`/chat/${encodeURIComponent(s.id)}`)
		} catch (e) {
			toasts.error(`Could not start a chat: ${(e as Error).message}`)
			return
		} finally {
			creating.value = false
		}
	}
	stickToBottom = true
	// Tagging other bots gets Desktop's identification note, so this bot knows exactly whom it should contact.
	const note = mentionNote(resolveMentions(text, bots.bots, activeProfile.value))
	sessions.send(target, text + note, images)
}

async function continueInCopy() {
	if (!id.value) return
	if (!confirm('Copy this conversation into a new chat you can continue here? Hermes marks the original as branched.'))
		return
	try {
		const s = await sessions.fork(id.value)
		router.push(`/chat/${encodeURIComponent(s.id)}`)
	} catch (e) {
		toasts.error((e as Error).message)
	}
}

const greeting = computed(() =>
	bot.value
		? `What should ${bot.value.displayName} work on?`
		: project.value
			? `New chat in ${project.value.name}`
			: 'What should Hermes work on?',
)
const intro = computed(
	() =>
		(bot.value ? bot.value.description : project.value?.description) ||
		'Hermes can run commands, browse, write files and use its skills on the machine it lives on. You can watch each step and approve risky ones.',
)
// The tab names the bot or the chat, and says so when a run waits for an approval, so it shows from another tab.
const needsApproval = computed(() => !!(live.value?.approval ?? remote.value?.approval))
useTitle(() => {
	const name = bot.value
		? bot.value.displayName
		: id.value
			? session.value?.title || session.value?.preview?.slice(0, 60) || 'Untitled chat'
			: project.value
				? `New chat in ${project.value.name}`
				: 'New chat'
	return needsApproval.value ? `Approval needed – ${name}` : name
})
// The bot this chat talks to: the open bot, or Hermes itself in the main chat. @ offers every other bot.
const activeProfile = computed(() => botName.value ?? 'default')
watch(
	() => app.dashboard?.ok,
	(ok) => ok && !bots.loaded && bots.load(),
	{ immediate: true },
)
/** A user turn's text as it should read: without the appended note, or as a notice from another bot. */
function userView(text: string) {
	const notice = parseBotNotice(text)
	if (notice) {
		const from = bots.bots.find((b) => b.handle === notice.handle || b.name === notice.handle)
		return { notice, from, text: notice.body }
	}
	return { notice: null, from: undefined, text: stripMentionNote(text) }
}
const shownModel = computed(() => (bot.value ? bot.value.model : model.value))
const connectingBot = ref(false)
async function connectThisBot() {
	if (!bot.value) return
	connectingBot.value = true
	await connectBot(bot.value)
	connectingBot.value = false
}
</script>

<template>
	<div class="flex h-full">
		<div class="hidden md:block">
			<BotSidebar v-if="botName && !fromChats" :active="botName" />
			<SessionSidebar v-else :active-id="botName ? undefined : id" :active-bot="botName" />
		</div>
		<Transition name="drawer">
			<div v-if="drawer" class="fixed inset-0 z-40 md:hidden">
				<div class="absolute inset-0 bg-black/40" @click="drawer = false" />
				<div
					class="drawer-panel absolute inset-y-0 left-0 w-[85%] max-w-xs bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
				>
					<BotSidebar v-if="botName && !fromChats" :active="botName" @navigate="drawer = false" />
					<SessionSidebar
						v-else
						:active-id="botName ? undefined : id"
						:active-bot="botName"
						@navigate="drawer = false"
					/>
				</div>
			</div>
		</Transition>

		<section class="flex min-w-0 flex-1 flex-col">
			<header class="relative flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-6">
				<div class="pointer-events-none absolute inset-x-0 top-full z-10 flex flex-col items-center">
					<Transition name="fade">
						<div v-if="refreshing" class="refresh-status w-full" role="status">
							<div class="refresh-bar" />
							<span class="refresh-pill mx-auto mt-2">Refreshing chat…</span>
						</div>
						<div
							v-else-if="refreshError"
							class="refresh-pill pointer-events-auto mt-2 gap-2 pr-1"
							role="status"
							:title="refreshError"
						>
							Could not refresh. Showing a saved copy.
							<button class="btn-ghost h-6 px-2 text-xs" @click="retryRefresh">Try again</button>
						</div>
					</Transition>
				</div>
				<button
					class="icon-btn md:hidden"
					:aria-label="botName && !fromChats ? 'Show bots' : 'Show chats'"
					@click="drawer = true"
				>
					<PanelLeft :size="18" />
				</button>
				<template v-if="botName">
					<BotAvatar
						:seed="botName"
						:look="bot?.look"
						:image="bot?.image"
						:state="botState.state"
						:hint="botState.hint"
						:alt="bot?.displayName ?? botName"
						:size="34"
					/>
					<div class="min-w-0 flex-1">
						<h1 class="truncate text-base font-semibold">{{ bot?.displayName ?? botName }}</h1>
						<p class="truncate text-xs text-ink-3">
							{{
								botState.state !== 'idle'
									? (botState.hint ?? STATE_LABELS[botState.state])
									: `@${bot?.handle ?? botName}`
							}}
						</p>
					</div>
					<span v-if="shownModel" class="chip hidden sm:inline-flex" title="Model this bot uses">{{ shownModel }}</span>
					<button
						v-if="bot"
						class="icon-btn"
						:class="{ 'bg-surface-2 text-ink': routinesOpen }"
						:aria-pressed="routinesOpen"
						aria-label="Routines"
						title="Routines"
						@click="routinesOpen = !routinesOpen"
					>
						<CalendarClock :size="17" />
					</button>
					<button v-if="bot" class="icon-btn" :aria-label="`${bot.displayName} settings`" @click="editingBot = true">
						<Settings2 :size="17" />
					</button>
				</template>
				<div v-else class="min-w-0 flex-1">
					<h1 class="truncate text-base font-semibold">
						{{ session?.title || session?.preview?.slice(0, 70) || (id ? 'Untitled chat' : 'New chat') }}
					</h1>
					<p class="flex items-center gap-2 truncate text-xs text-ink-3">
						<span v-if="project" class="inline-flex items-center gap-1">
							<span class="size-1.5 rounded-full" :style="{ background: PROJECT_COLORS[project.color] }" />{{
								project.name
							}}
						</span>
						<span v-if="foreign">From {{ sourceLabel(session?.source) }}</span>
						<span v-if="session?.started_at">{{ dateTime(session.started_at) }}</span>
					</p>
				</div>
				<span v-if="model && !botName" class="chip hidden sm:inline-flex" :title="'Model used for new turns'">{{
					model
				}}</span>
			</header>

			<div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" @scroll="onScroll">
				<div v-if="!id" class="mx-auto flex h-full max-w-4xl flex-col justify-end px-4 pb-6 md:px-8">
					<template v-if="bot && !bot.connected">
						<BotAvatar :seed="bot.name" :look="bot.look" :image="bot.image" :alt="bot.displayName" :size="64" />
						<h2 class="display mt-4 mb-2 text-3xl">Connect {{ bot.displayName }}</h2>
						<p class="mb-4 max-w-[60ch] text-ink-2">
							This bot was made outside Caduceus. To chat with it, Caduceus gives it a gateway key of its own and keeps
							that key on this server.
						</p>
						<button class="btn-primary self-start" :disabled="connectingBot" @click="connectThisBot">
							Connect bot
						</button>
					</template>
					<template v-else>
						<BotAvatar
							v-if="bot"
							:seed="bot.name"
							:look="bot.look"
							:image="bot.image"
							:alt="bot.displayName"
							:size="64"
							class="mb-4"
						/>
						<h2 class="display mb-2 text-3xl">{{ greeting }}</h2>
						<p class="mb-6 max-w-[60ch] text-ink-2">{{ intro }}</p>
					</template>
				</div>
				<div v-else ref="content" class="mx-auto max-w-4xl px-4 py-6 md:px-8">
					<div
						v-if="botSession && bot"
						class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2"
					>
						<span
							>Another conversation of {{ bot.displayName }}:
							<span class="font-medium text-ink">{{ session?.title || 'Untitled' }}</span></span
						>
						<RouterLink :to="`${botBase}/${encodeURIComponent(bot.name)}`" class="btn-outline h-7"
							>Back to Bot Chat</RouterLink
						>
					</div>
					<div v-if="skeleton" class="skeleton" role="status" aria-label="Loading conversation">
						<template v-for="i in 2" :key="i">
							<div class="my-6 flex justify-end">
								<span class="skeleton-bar h-10 rounded-2xl rounded-br-md" :style="{ width: i === 1 ? '46%' : '32%' }" />
							</div>
							<div class="flex max-w-[72ch] flex-col gap-2.5">
								<span class="skeleton-bar mb-1.5 h-3 w-36" />
								<span class="skeleton-bar h-3 w-[92%]" />
								<span class="skeleton-bar h-3 w-[84%]" />
								<span class="skeleton-bar h-3 w-[88%]" />
								<span class="skeleton-bar h-3" :style="{ width: i === 1 ? '40%' : '62%' }" />
							</div>
						</template>
					</div>
					<p v-else-if="!turns.length" class="text-sm text-ink-3">No messages yet. Write the first one below.</p>
					<div v-else :class="{ 'turns-fade': fadeIn }">
						<button
							v-if="earlier || olderOnServer"
							ref="sentinel"
							class="btn-ghost mx-auto mb-2 flex"
							:disabled="loadingOlder"
							:aria-busy="loadingOlder"
							@click="showEarlier"
						>
							Show earlier messages
						</button>
						<template v-for="t in shownTurns" :key="t.key">
							<details
								v-if="t.kind === 'user' && parseSystemNotice(t.text)"
								class="my-4 max-w-[72ch] rounded-lg border border-line px-3 py-2 text-sm"
							>
								<summary class="cursor-pointer text-ink-2">
									{{ parseSystemNotice(t.text)!.title }}
									<span v-if="parseSystemNotice(t.text)!.body" class="text-ink">
										{{ parseSystemNotice(t.text)!.body }}</span
									>
								</summary>
								<pre class="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-ink-3">{{
									parseSystemNotice(t.text)!.details
								}}</pre>
							</details>
							<div
								v-else-if="t.kind === 'user' && userView(t.text).notice"
								class="my-6 flex max-w-[85%] gap-3"
								:class="{ 'turn-sent': t.key === 'live-user' }"
							>
								<BotAvatar
									:seed="userView(t.text).from?.name ?? userView(t.text).notice!.handle"
									:look="userView(t.text).from?.look"
									:image="userView(t.text).from?.image"
									:alt="userView(t.text).notice!.from"
									:size="28"
									still
									class="mt-0.5"
								/>
								<div class="min-w-0 rounded-2xl rounded-tl-md border border-line px-4 py-2.5">
									<p class="mb-1 text-xs text-ink-3">
										Message from
										<span class="font-medium text-ink-2">{{
											userView(t.text).from?.displayName ?? userView(t.text).notice!.from
										}}</span>
										@{{ userView(t.text).notice!.handle
										}}<template v-if="userView(t.text).notice!.notifyOnly">, no reply needed</template>
									</p>
									<p class="whitespace-pre-wrap">
										<MentionText :text="userView(t.text).text" :bots="bots.bots" />
									</p>
								</div>
							</div>
							<div
								v-else-if="t.kind === 'user'"
								class="my-6 flex justify-end"
								:class="{ 'turn-sent': t.key === 'live-user' }"
							>
								<div class="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5">
									<div v-if="t.images.length" class="mb-2 flex flex-wrap gap-2">
										<img
											v-for="(src, i) in t.images"
											:key="i"
											:src="src"
											alt="Attached image"
											class="max-h-48 rounded-md"
										/>
									</div>
									<p class="whitespace-pre-wrap">
										<MentionText :text="userView(t.text).text" :bots="bots.bots" />
									</p>
								</div>
							</div>
							<div v-else-if="bot" class="flex gap-3">
								<BotAvatar
									:seed="bot.name"
									:look="bot.look"
									:image="bot.image"
									:state="t.key === lastAgentKey ? botState.state : 'idle'"
									:hint="t.key === lastAgentKey ? botState.hint : undefined"
									:alt="bot.displayName"
									:size="28"
									:still="t.key !== lastAgentKey"
									class="mt-0.5"
								/>
								<AgentTurnView
									class="min-w-0 flex-1"
									bot
									:turn="t"
									:status="t.live ? (liveStatus ?? botState.hint) : undefined"
									@approve="(c) => id && sessions.answerApproval(id, c)"
								/>
							</div>
							<AgentTurnView
								v-else
								:turn="t"
								:status="t.live ? liveStatus : undefined"
								@approve="(c) => id && sessions.answerApproval(id, c)"
							/>
						</template>
					</div>
					<p v-if="lastError && !live" class="mt-3 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm">
						{{ lastError }}
					</p>
				</div>
			</div>

			<div class="mx-auto w-full max-w-4xl px-3 pb-3 md:px-8 md:pb-5">
				<div
					v-if="foreign && !live && !remote"
					class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2"
				>
					<span
						>This conversation came from {{ sourceLabel(session?.source) }}. Hermes may not accept replies to it from
						here.</span
					>
					<button class="btn-outline h-7" @click="continueInCopy"><GitFork :size="14" /> Continue in a copy</button>
				</div>
				<Composer
					ref="composer"
					:draft-key="id ?? (botName ? `bot:${botName}` : 'new')"
					:running="running"
					:disabled="creating || !app.gateway?.ok || (!!bot && !bot.connected)"
					:placeholder="
						!app.gateway?.ok
							? 'Connect the gateway API to chat'
							: running
								? `Redirect ${bot?.displayName ?? 'Hermes'}`
								: bot
									? `Message ${bot.displayName}`
									: undefined
					"
					autofocus
					:mentions="bots.bots"
					:active-bot="activeProfile"
					@send="send"
					@stop="id && sessions.stop(id)"
				/>
			</div>
		</section>
		<div v-if="bot && routinesOpen" class="fixed inset-0 z-40 md:static md:z-auto md:h-full">
			<RoutinesPanel :key="bot.name" :bot="bot" @close="routinesOpen = false" />
		</div>
		<BotSettingsModal v-if="editingBot && bot" :bot="bot" @close="editingBot = false" />
	</div>
</template>

<style scoped>
/* The refresh note floats over the conversation, so it never shifts the chat as it comes and goes. */
.refresh-status {
	display: flex;
	flex-direction: column;
}
.refresh-pill {
	display: inline-flex;
	align-items: center;
	border: 1px solid var(--line);
	border-radius: 9999px;
	background: var(--surface);
	padding: 0.125rem 0.625rem;
	font-size: 0.75rem;
	color: var(--ink-3);
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}
/* Same 150ms grace as the refresh bar, so a quick refresh never shows its label either. */
.refresh-status .refresh-pill {
	animation: skeleton-in var(--dur) var(--ease-out) 150ms both;
}

/* A message the user just sent rises into place; nothing else in the list moves. */
.turn-sent {
	animation: turn-sent var(--dur) var(--ease-out);
}
@keyframes turn-sent {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
}
.turns-fade {
	animation: turns-fade var(--dur) var(--ease-out);
}
@keyframes turns-fade {
	from {
		opacity: 0;
	}
}
</style>
