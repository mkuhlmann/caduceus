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

/** 980, 15.4k, 124k, 1.2M: token counts as short as the line needs them. */
function fmtTokens(n: number) {
	if (n < 1000) return String(n)
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
	return `${(n / 1_000_000).toFixed(1)}M`
}

const pp = computed(() => ppRate(props.stats))
/** Every prompt token the model was given: read fresh or taken from the cache. */
const promptAll = computed(() => (props.stats.promptTokens ?? 0) + (props.stats.cachedTokens ?? 0))
const cachedShare = computed(() => {
	const c = props.stats.cachedTokens ?? 0
	if (!c || !promptAll.value) return ''
	const pct = (c / promptAll.value) * 100
	// Never round a fresh read away: 99.9% reads as ">99%", not "100%".
	return pct > 99 && c < promptAll.value ? '>99%' : `${Math.round(pct)}%`
})
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
const inTitle = computed(() => {
	const s = props.stats
	const calls = s.calls && s.calls > 1 ? ` over ${s.calls} model calls` : ''
	const split = s.cachedTokens
		? `: ${(s.promptTokens ?? 0).toLocaleString()} read fresh, ${s.cachedTokens.toLocaleString()} from the cache`
		: ''
	// No reading speed shown: say why.
	const why =
		pp.value === undefined && s.cachedTokens
			? '. So little was read fresh that the wait before the reply was mostly latency, so there is no reading speed to show'
			: ''
	return `${promptAll.value.toLocaleString()} prompt tokens${calls}${split}${why}`
})
const outTitle = computed(() => `${props.stats.outputTokens?.toLocaleString()} tokens written, reasoning included`)
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
		<div v-if="promptAll" :title="inTitle">
			<dt class="sr-only">Prompt tokens</dt>
			<dd>
				{{ fmtTokens(promptAll) }} in<template v-if="cachedShare">, {{ cachedShare }} cached</template>
			</dd>
		</div>
		<div v-if="stats.outputTokens" :title="outTitle">
			<dt class="sr-only">Tokens written</dt>
			<dd>{{ fmtTokens(stats.outputTokens) }} out</dd>
		</div>
		<div :title="totalTitle">
			<dt class="sr-only">Total time</dt>
			<dd>{{ fmtTime(stats.totalMs) }} total</dd>
		</div>
	</dl>
</template>
