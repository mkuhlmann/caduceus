<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import type { AgentTurn, ApprovalStep, Step, TextStep, ToolStep } from '@/lib/turns'
import { prettyToolName } from '@/lib/turns'
import { renderMarkdown, handleCodeCopy } from '@/lib/markdown'
import ToolWaypoint from './ToolWaypoint.vue'

const props = defineProps<{ turn: AgentTurn; status?: string }>()
const emit = defineEmits<{ approve: [choice: string] }>()

type Segment =
	| { kind: 'tools'; key: string; steps: ToolStep[] }
	| { kind: 'text'; key: string; step: TextStep }
	| { kind: 'approval'; key: string; step: ApprovalStep }

/** Consecutive tool calls become one stretch of the route. */
const segments = computed<Segment[]>(() => {
	const out: Segment[] = []
	props.turn.steps.forEach((s: Step, i) => {
		const prev = out.at(-1)
		if (s.kind === 'tool') {
			if (prev?.kind === 'tools') prev.steps.push(s)
			else out.push({ kind: 'tools', key: `t${i}`, steps: [s] })
		} else if (s.kind === 'text') out.push({ kind: 'text', key: `x${i}`, step: s })
		else out.push({ kind: 'approval', key: `a${i}`, step: s })
	})
	return out
})

const expanded = ref<Record<string, boolean>>({})
const showReasoning = ref(false)

function isOpen(seg: Segment, idx: number) {
	if (expanded.value[seg.key] !== undefined) return expanded.value[seg.key]
	// While live, the stretch being walked stays open; finished stretches fold away.
	return !!props.turn.live && idx === segments.value.length - 1
}

function stretchLabel(steps: ToolStep[]) {
	const names = [...new Set(steps.map((s) => prettyToolName(s.name)))]
	const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')
	const failed = steps.filter((s) => s.status === 'failed').length
	return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}: ${shown}${failed ? `, ${failed} failed` : ''}`
}

const CHOICE_LABELS: Record<string, string> = {
	once: 'Allow once',
	session: 'Allow for this chat',
	always: 'Always allow',
	deny: 'Deny',
}
const RESOLVED_LABELS: Record<string, string> = {
	once: 'Allowed once',
	session: 'Allowed for this chat',
	always: 'Always allowed',
	deny: 'Denied',
}

const waiting = computed(() => props.turn.live && props.turn.steps.length === 0)
</script>

<template>
	<article class="agent-turn" :class="{ live: turn.live }" @click="handleCodeCopy">
		<button
			v-if="turn.reasoning"
			class="mb-2 flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
			:aria-expanded="showReasoning"
			@click="showReasoning = !showReasoning"
		>
			<ChevronRight :size="14" class="transition-transform" :class="{ 'rotate-90': showReasoning }" />
			{{ turn.live && !turn.steps.length ? 'Thinking' : 'Thought process' }}
		</button>
		<p
			v-if="showReasoning"
			class="mb-3 max-w-[72ch] border-l-2 border-line pl-3 text-sm whitespace-pre-wrap text-ink-2"
		>
			{{ turn.reasoning }}
		</p>

		<p v-if="waiting && !turn.reasoning" class="route-thread py-1 pl-6 text-sm text-ink-3">
			<span class="live-dot" />{{ status || 'Working' }}
		</p>

		<template v-for="(seg, idx) in segments" :key="seg.key">
			<div v-if="seg.kind === 'tools'" class="route-thread my-1.5">
				<button
					v-if="!turn.live || idx !== segments.length - 1"
					class="flex items-center gap-1 py-1 pl-6 text-sm text-ink-3 hover:text-ink"
					:aria-expanded="isOpen(seg, idx)"
					@click="expanded[seg.key] = !isOpen(seg, idx)"
				>
					<ChevronRight :size="14" class="transition-transform" :class="{ 'rotate-90': isOpen(seg, idx) }" />
					{{ stretchLabel(seg.steps) }}
				</button>
				<ul v-if="isOpen(seg, idx)">
					<ToolWaypoint v-for="(s, i) in seg.steps" :key="i" :step="s" />
				</ul>
			</div>

			<div
				v-else-if="seg.kind === 'text'"
				class="prose-h my-2"
				:class="{ 'streaming-caret': turn.live && idx === segments.length - 1 }"
				v-html="renderMarkdown(seg.step.text)"
			/>

			<div v-else class="route-thread my-3">
				<div class="ml-6 max-w-[72ch] rounded-lg border border-gold/50 bg-gold-soft/40 p-3">
					<p class="text-sm font-medium">Hermes wants to run a command that needs your approval</p>
					<p v-if="seg.step.description" class="mt-0.5 text-sm text-ink-2">{{ seg.step.description }}</p>
					<pre
						v-if="seg.step.command"
						class="mt-2 overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap"
						>{{ seg.step.command }}</pre>
					<div v-if="!seg.step.resolved" class="mt-3 flex flex-wrap gap-2">
						<button
							v-for="c in seg.step.choices"
							:key="c"
							:class="c === 'deny' ? 'btn-danger' : c === 'once' ? 'btn-primary' : 'btn-outline'"
							@click="emit('approve', c)"
						>
							{{ CHOICE_LABELS[c] ?? c }}
						</button>
					</div>
					<p v-else class="mt-2 text-sm text-ink-2">{{ RESOLVED_LABELS[seg.step.resolved] ?? seg.step.resolved }}</p>
				</div>
			</div>
		</template>

		<p
			v-if="
				turn.live &&
				segments.length &&
				segments.at(-1)?.kind !== 'text' &&
				!turn.steps.some((s) => s.kind === 'approval' && !s.resolved)
			"
			class="route-thread py-1 pl-6 text-sm text-ink-3"
		>
			<span class="live-dot" />{{ status || 'Working' }}
		</p>

		<p v-if="turn.error" class="mt-2 max-w-[72ch] rounded-md bg-rose-soft px-3 py-2 text-sm">{{ turn.error }}</p>
	</article>
</template>

<style scoped>
/* Replies run a little wider than general reading text: they carry code, tables and command output. */
.agent-turn .prose-h {
	max-width: 88ch;
}
/* The route: a thread down the left edge that the agent walks. Gold while it is moving. */
.route-thread {
	position: relative;
}
.route-thread::before {
	content: '';
	position: absolute;
	left: 0;
	top: 0.25rem;
	bottom: 0.25rem;
	width: 2px;
	border-radius: 2px;
	background: var(--line);
}
.live .route-thread:last-of-type::before {
	background: var(--gold);
}
.live-dot {
	position: absolute;
	left: -4px;
	top: 0.65rem;
	width: 10px;
	height: 10px;
	border-radius: 999px;
	background: var(--gold);
	animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
	50% {
		opacity: 0.35;
	}
}
.streaming-caret :deep(> :last-child)::after {
	content: '';
	display: inline-block;
	width: 0.5em;
	height: 1em;
	margin-left: 2px;
	vertical-align: -0.12em;
	background: var(--gold);
	animation: pulse 1s steps(2) infinite;
}
</style>
