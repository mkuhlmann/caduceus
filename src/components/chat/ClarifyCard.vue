<script setup lang="ts">
import { computed, ref } from 'vue'
import { Send } from 'lucide-vue-next'
import type { ClarifyStep } from '@/lib/turns'

/** A question the agent asked with its clarify tool: pick a choice, several, or write an answer of your own. */
const props = defineProps<{ step: ClarifyStep; send?: (answer: string) => Promise<void> }>()

const picked = ref<string[]>([])
const own = ref('')
const sending = ref(false)

const open = computed(() => props.step.answer === undefined && !!props.send)

/** A multi-select answer is a JSON array of labels; show it as a list. */
const answered = computed(() => {
	const a = props.step.answer
	if (a === undefined) return ''
	if (a === 'elsewhere') return 'Answered elsewhere'
	if (props.step.multiSelect) {
		try {
			const v = JSON.parse(a)
			if (Array.isArray(v)) return `You answered: ${v.join(', ')}`
		} catch {}
	}
	return `You answered: ${a}`
})

async function answer(text: string) {
	if (!props.send || sending.value || !text.trim()) return
	sending.value = true
	try {
		await props.send(text.trim())
	} finally {
		sending.value = false
	}
}

function toggle(c: string) {
	picked.value = picked.value.includes(c) ? picked.value.filter((x) => x !== c) : [...picked.value, c]
}

function sendPicked() {
	// Keep the order the agent offered them in.
	const chosen = props.step.choices.filter((c) => picked.value.includes(c))
	if (chosen.length) void answer(JSON.stringify(chosen))
}
</script>

<template>
	<div class="ml-6 max-w-[72ch] rounded-lg border border-gold/50 bg-gold-soft/40 p-3">
		<p class="text-sm font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{{ step.question }}</p>

		<template v-if="open">
			<div v-if="step.choices.length && !step.multiSelect" class="mt-3 flex flex-col items-start gap-2">
				<button
					v-for="c in step.choices"
					:key="c"
					class="btn-outline h-auto min-h-8 justify-start py-1.5 text-left whitespace-normal"
					:disabled="sending"
					@click="answer(c)"
				>
					{{ c }}
				</button>
			</div>
			<fieldset v-else-if="step.choices.length" class="mt-3 space-y-1.5" :disabled="sending">
				<legend class="sr-only">Pick one or more</legend>
				<label v-for="c in step.choices" :key="c" class="flex cursor-pointer items-start gap-2 text-sm">
					<input
						type="checkbox"
						class="mt-0.5 accent-[var(--gold)]"
						:checked="picked.includes(c)"
						@change="toggle(c)"
					/>
					<span>{{ c }}</span>
				</label>
				<button class="btn-primary mt-1" :disabled="!picked.length || sending" @click="sendPicked">Send answer</button>
			</fieldset>

			<form class="mt-3 flex items-center gap-2" @submit.prevent="answer(own)">
				<input
					v-model="own"
					class="field flex-1"
					:placeholder="step.choices.length ? 'Or write your own answer' : 'Your answer'"
					:aria-label="step.choices.length ? 'Your own answer' : 'Your answer'"
					:disabled="sending"
				/>
				<button
					:class="step.choices.length ? 'icon-btn' : 'btn-primary'"
					type="submit"
					:disabled="!own.trim() || sending"
					:aria-label="step.choices.length ? 'Send your own answer' : undefined"
				>
					<Send v-if="step.choices.length" :size="16" />
					<template v-else>Send answer</template>
				</button>
			</form>
		</template>
		<p v-else-if="answered" class="mt-2 text-sm text-ink-2">{{ answered }}</p>
	</div>
</template>
