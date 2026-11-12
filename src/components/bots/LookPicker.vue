<script setup lang="ts">
import { ref } from 'vue'
import { Shuffle, ImageUp, X } from 'lucide-vue-next'
import BotAvatar from './BotAvatar.vue'
import { COLORS, COLOR_LABELS, SHAPES, SHAPE_LABELS, randomLook, squareImage, type BotLook } from '@/lib/avatar'
import { useToasts } from '@/stores/toast'

/** Pick a bot's body and colour, shuffle one, or use a picture instead. */
const props = defineProps<{ seed: string; alt?: string }>()
const look = defineModel<BotLook>('look', { required: true })
const image = defineModel<string | null>('image', { default: null })
const toasts = useToasts()
const file = ref<HTMLInputElement>()

function set<K extends keyof BotLook>(k: K, v: BotLook[K]) {
	look.value = { ...look.value, [k]: v }
}

async function upload(e: Event) {
	const f = (e.target as HTMLInputElement).files?.[0]
	if (!f) return
	try {
		image.value = await squareImage(f)
	} catch {
		toasts.error('That file could not be read as a picture. Try a PNG, JPEG or WebP image.')
	} finally {
		if (file.value) file.value.value = ''
	}
}
</script>

<template>
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
		<div class="flex items-center gap-3 sm:flex-col">
			<BotAvatar :seed="props.seed || 'new'" :look="look" :image="image" :size="72" :alt="alt" />
			<div class="flex gap-1 sm:flex-col">
				<button type="button" class="btn-ghost h-8" :disabled="!!image" @click="look = randomLook()">
					<Shuffle :size="16" /> Shuffle
				</button>
				<button v-if="!image" type="button" class="btn-ghost h-8" @click="file?.click()">
					<ImageUp :size="16" /> Use a picture
				</button>
				<button v-else type="button" class="btn-ghost h-8" @click="image = null">
					<X :size="16" /> Remove picture
				</button>
				<input ref="file" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="upload" />
			</div>
		</div>
		<fieldset class="flex min-w-0 flex-1 flex-col gap-3" :disabled="!!image" :class="{ 'opacity-50': image }">
			<div>
				<p class="label">Body</p>
				<div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Body">
					<button
						v-for="s in SHAPES"
						:key="s"
						type="button"
						role="radio"
						:aria-checked="look.shape === s"
						:title="SHAPE_LABELS[s]"
						class="pick"
						:class="{ on: look.shape === s }"
						@click="set('shape', s)"
					>
						<BotAvatar :seed="seed" :look="{ ...look, shape: s }" :size="28" :alt="SHAPE_LABELS[s]" still />
					</button>
				</div>
			</div>
			<div>
				<p class="label">Colour</p>
				<div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Colour">
					<button
						v-for="(hex, c) in COLORS"
						:key="c"
						type="button"
						role="radio"
						:aria-checked="look.color === c"
						:aria-label="COLOR_LABELS[c]"
						:title="COLOR_LABELS[c]"
						class="pick"
						:class="{ on: look.color === c }"
						@click="set('color', String(c))"
					>
						<span class="block size-6 rounded-full ring-1 ring-line ring-inset" :style="{ background: hex }" />
					</button>
				</div>
			</div>
		</fieldset>
	</div>
</template>

<style scoped>
.pick {
	border-radius: 0.6rem;
	padding: 4px;
	border: 2px solid transparent;
	transition: transform var(--dur-fast) var(--ease-out);
}
.pick:hover:not(:disabled) {
	background: var(--surface-2);
}
.pick:active:not(:disabled) {
	transform: scale(0.94);
}
.pick.on {
	border-color: var(--focus);
}
</style>
