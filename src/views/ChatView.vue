<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PanelLeft, GitFork } from 'lucide-vue-next'
import { useSessions, sourceLabel } from '@/stores/sessions'
import { useProjects, PROJECT_COLORS } from '@/stores/projects'
import { useApp } from '@/stores/app'
import { useToasts } from '@/stores/toast'
import { dashboard } from '@/lib/dashboard'
import { dateTime } from '@/lib/time'
import SessionSidebar from '@/components/chat/SessionSidebar.vue'
import AgentTurnView from '@/components/chat/AgentTurnView.vue'
import Composer from '@/components/chat/Composer.vue'

const route = useRoute()
const router = useRouter()
const sessions = useSessions()
const projects = useProjects()
const app = useApp()
const toasts = useToasts()

const id = computed(() => (route.params.id as string | undefined) || undefined)
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
const foreign = computed(() => session.value?.source && !['api_server'].includes(session.value.source))

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
		if (v && !sessions.live[v]) await sessions.loadMessages(v)
		if (v !== id.value) return
		sessions.follow(v)
		scrollDown()
	},
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

/** Add earlier turns above, keeping the reader's place. */
function showEarlier() {
	const el = scroller.value
	if (!el || !earlier.value) return
	const fromBottom = el.scrollHeight - el.scrollTop
	limit.value += PAGE
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
	let target = id.value
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
	sessions.send(target, text, images)
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

const greeting = computed(() => (project.value ? `New chat in ${project.value.name}` : 'What should Hermes work on?'))
</script>

<template>
	<div class="flex h-full">
		<div class="hidden md:block">
			<SessionSidebar :active-id="id" />
		</div>
		<Transition name="drawer">
			<div v-if="drawer" class="fixed inset-0 z-40 md:hidden">
				<div class="absolute inset-0 bg-black/40" @click="drawer = false" />
				<div
					class="drawer-panel absolute inset-y-0 left-0 w-[85%] max-w-xs bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
				>
					<SessionSidebar :active-id="id" @navigate="drawer = false" />
				</div>
			</div>
		</Transition>

		<section class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-6">
				<button class="icon-btn md:hidden" aria-label="Show chats" @click="drawer = true">
					<PanelLeft :size="18" />
				</button>
				<div class="min-w-0 flex-1">
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
				<span v-if="model" class="chip hidden sm:inline-flex" :title="'Model used for new turns'">{{ model }}</span>
			</header>

			<div ref="scroller" class="min-h-0 flex-1 overflow-y-auto" @scroll="onScroll">
				<div v-if="!id" class="mx-auto flex h-full max-w-4xl flex-col justify-end px-4 pb-6 md:px-8">
					<h2 class="display mb-2 text-3xl">{{ greeting }}</h2>
					<p class="mb-6 max-w-[60ch] text-ink-2">
						{{
							project?.description ||
							'Hermes can run commands, browse, write files and use its skills on the machine it lives on. You can watch each step and approve risky ones.'
						}}
					</p>
				</div>
				<div v-else ref="content" class="mx-auto max-w-4xl px-4 py-6 md:px-8">
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
						<button v-if="earlier" ref="sentinel" class="btn-ghost mx-auto mb-2 flex" @click="showEarlier">
							Show earlier messages
						</button>
						<template v-for="t in shownTurns" :key="t.key">
							<div
								v-if="t.kind === 'user'"
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
									<p class="whitespace-pre-wrap">{{ t.text }}</p>
								</div>
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
					:draft-key="id ?? 'new'"
					:running="running"
					:disabled="creating || !app.gateway?.ok"
					:placeholder="!app.gateway?.ok ? 'Connect the gateway API to chat' : running ? 'Redirect Hermes' : undefined"
					autofocus
					@send="send"
					@stop="id && sessions.stop(id)"
				/>
			</div>
		</section>
	</div>
</template>

<style scoped>
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
