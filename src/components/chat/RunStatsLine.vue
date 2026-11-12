<script setup lang="ts">
import { computed } from 'vue'
import type { RunStats } from '@/lib/run-stats'
import { ppRate, tgRate } from '@/lib/run-stats'

const props = defineProps<{ stats: RunStats }>()

const fmtRate = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1))
function fmtTime(ms: number) {
	const s = ms / 1000
	if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
	const m = Math.floor(s / 60)
	return `${m} min ${Math.round(s - m * 60)} s`
}

const pp = computed(() => ppRate(props.stats))
const tg = computed(() => tgRate(props.stats))
const ppTitle = computed(() => {
	const s = props.stats
	const cached = s.cachedTokens ? `, ${s.cachedTokens.toLocaleString()} more came from the cache` : ''
	return `Prompt processing: ${s.promptTokens?.toLocaleString()} prompt tokens read in ${fmtTime(s.promptMs ?? 0)}${cached}`
})
const tgTitle = computed(() => {
	const s = props.stats
	return `Token generation: ${s.outputTokens?.toLocaleString()} tokens written in ${fmtTime(s.genMs ?? 0)}`
})
const totalTitle = computed(() => {
	const s = props.stats
	const calls = s.calls ? ` across ${s.calls} model ${s.calls === 1 ? 'call' : 'calls'}` : ''
	const tools = s.toolMs ? `, ${fmtTime(s.toolMs)} of it running tools` : ''
	return `From sending the message to the end of the reply${calls}${tools}`
})
</script>

<template>
	<dl class="run-stats mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3 tabular-nums">
		<div v-if="pp !== undefined" :title="ppTitle">
			<dt class="sr-only">Prompt processing</dt>
			<dd>{{ fmtRate(pp) }} pp/s</dd>
		</div>
		<div v-if="tg !== undefined" :title="tgTitle">
			<dt class="sr-only">Token generation</dt>
			<dd>{{ fmtRate(tg) }} tg/s</dd>
		</div>
		<div :title="totalTitle">
			<dt class="sr-only">Total time</dt>
			<dd>{{ fmtTime(stats.totalMs) }} total</dd>
		</div>
	</dl>
</template>
