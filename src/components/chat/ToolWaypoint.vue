<script setup lang="ts">
import { computed, ref } from 'vue'
import { prettyToolName, toolSummary, type ToolStep } from '@/lib/turns'

const props = defineProps<{ step: ToolStep }>()
const open = ref(false)
const summary = computed(() => toolSummary(props.step))
const hasDetail = computed(() => !!props.step.output || (props.step.args && Object.keys(props.step.args).length > 0))

const output = computed(() => {
	const raw = props.step.output ?? ''
	// Most tools return {"output": "..."}; show the payload, not the envelope.
	try {
		const v = JSON.parse(raw)
		if (v && typeof v === 'object' && typeof v.output === 'string') return v.output
		return JSON.stringify(v, null, 2)
	} catch {
		return raw
	}
})
</script>

<template>
	<li class="relative pl-6">
		<span
			class="absolute top-[0.6rem] left-[-4px] size-2.5 rounded-full border-2"
			:class="{
				'animate-pulse border-gold bg-gold': step.status === 'running',
				'border-ink-3 bg-bg': step.status === 'done',
				'border-rose bg-rose': step.status === 'failed',
			}"
		/>
		<button
			class="flex w-full min-w-0 items-baseline gap-2 rounded py-1 text-left text-sm disabled:cursor-default"
			:disabled="!hasDetail"
			:aria-expanded="hasDetail ? open : undefined"
			@click="open = !open"
		>
			<span class="shrink-0 font-medium" :class="step.status === 'failed' ? 'text-rose' : 'text-ink'">{{
				prettyToolName(step.name)
			}}</span>
			<span class="min-w-0 truncate text-ink-3">{{ summary }}</span>
		</button>
		<div v-if="open" class="mt-1 mb-2 space-y-2">
			<pre
				v-if="step.args && Object.keys(step.args).length"
				class="max-h-48 overflow-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2"
				>{{ JSON.stringify(step.args, null, 2) }}</pre>
			<pre
				v-if="output"
				class="max-h-80 overflow-auto rounded-md border border-line px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2"
				>{{ output.length > 20000 ? output.slice(0, 20000) + '\n…' : output }}</pre>
		</div>
	</li>
</template>
