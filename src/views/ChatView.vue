<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
const live = computed(() => (id.value ? sessions.live[id.value] : undefined))
const lastError = computed(() => (id.value ? sessions.lastError[id.value] : undefined))
const foreign = computed(() => session.value?.source && !['api_server'].includes(session.value.source))

const scroller = ref<HTMLElement>()
const composer = ref<InstanceType<typeof Composer>>()
const drawer = ref(false)
const model = ref('')
const creating = ref(false)
let stickToBottom = true

onMounted(async () => {
	if (!sessions.list.length) sessions.loadList()
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
		if (v && !sessions.live[v]) await sessions.loadMessages(v)
		stickToBottom = true
		scrollDown(true)
		nextTick(() => composer.value?.focus())
	},
	{ immediate: true },
)

function onScroll() {
	const el = scroller.value
	if (el) stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
}
function scrollDown(force = false) {
	nextTick(() => {
		const el = scroller.value
		if (el && (force || stickToBottom)) el.scrollTop = el.scrollHeight
	})
}
watch(
	() => {
		const t = live.value?.turn
		return t ? t.steps.length + (t.steps.at(-1) as any)?.text?.length : turns.value.length
	},
	() => scrollDown(),
)

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
		<div v-if="drawer" class="fixed inset-0 z-40 md:hidden">
			<div class="absolute inset-0 bg-black/40" @click="drawer = false" />
			<div class="absolute inset-y-0 left-0 w-[85%] max-w-xs shadow-2xl">
				<SessionSidebar :active-id="id" @navigate="drawer = false" />
			</div>
		</div>

		<section class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-6">
				<button class="icon-btn md:hidden" aria-label="Show chats" @click="drawer = true">
					<PanelLeft :size="18" />
				</button>
				<div class="min-w-0 flex-1">
					<h1 class="truncate text-base font-semibold">{{ session?.title || (id ? 'Untitled chat' : 'New chat') }}</h1>
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
				<div v-if="!id" class="mx-auto flex h-full max-w-3xl flex-col justify-end px-4 pb-6 md:px-8">
					<h2 class="display mb-2 text-3xl">{{ greeting }}</h2>
					<p class="mb-6 max-w-[60ch] text-ink-2">
						{{
							project?.description ||
							'Hermes can run commands, browse, write files and use its skills on the machine it lives on. You can watch each step and approve risky ones.'
						}}
					</p>
				</div>
				<div v-else class="mx-auto max-w-3xl px-4 py-6 md:px-8">
					<p v-if="sessions.loadingMessages && !turns.length" class="text-sm text-ink-3">Loading conversation</p>
					<p v-else-if="!turns.length" class="text-sm text-ink-3">No messages yet.</p>
					<template v-for="t in turns" :key="t.key">
						<div v-if="t.kind === 'user'" class="my-6 flex justify-end">
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
							:status="t.live ? live?.status : undefined"
							@approve="(c) => id && sessions.answerApproval(id, c)"
						/>
					</template>
					<p v-if="lastError && !live" class="mt-3 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm">
						{{ lastError }}
					</p>
				</div>
			</div>

			<div class="mx-auto w-full max-w-3xl px-3 pb-3 md:px-8 md:pb-5">
				<div
					v-if="foreign && !live"
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
					:running="!!live"
					:disabled="creating || !app.gateway?.ok"
					:placeholder="!app.gateway?.ok ? 'Connect the gateway API to chat' : live ? 'Redirect Hermes' : undefined"
					autofocus
					@send="send"
					@stop="id && sessions.stop(id)"
				/>
			</div>
		</section>
	</div>
</template>
