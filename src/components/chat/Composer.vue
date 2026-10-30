<script lang="ts">
// In-memory drafts per chat, so switching chats doesn't carry over typed text or images.
const drafts = new Map<string, { text: string; images: string[] }>()
</script>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ArrowUp, Square, ImagePlus, X } from 'lucide-vue-next'
import { useToasts } from '@/stores/toast'

const props = defineProps<{
	running?: boolean
	disabled?: boolean
	placeholder?: string
	autofocus?: boolean
	draftKey?: string
}>()
const emit = defineEmits<{ send: [text: string, images: string[]]; stop: [] }>()
const toasts = useToasts()
const text = ref('')
const images = ref<string[]>([])
const area = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)

const MAX_BYTES = 6 * 1024 * 1024

function grow() {
	const el = area.value
	if (!el) return
	el.style.height = 'auto'
	el.style.height = Math.min(el.scrollHeight, 320) + 'px'
}
watch(text, () => nextTick(grow))

watch(
	() => props.draftKey,
	(key, old) => {
		if (old !== undefined) {
			if (text.value || images.value.length) drafts.set(old, { text: text.value, images: [...images.value] })
			else drafts.delete(old)
		}
		const d = key !== undefined ? drafts.get(key) : undefined
		text.value = d?.text ?? ''
		images.value = d ? [...d.images] : []
	},
)

function submit() {
	const t = text.value.trim()
	if ((!t && !images.value.length) || props.disabled) return
	emit('send', t, images.value)
	text.value = ''
	images.value = []
	if (props.draftKey !== undefined) drafts.delete(props.draftKey)
}

function onKey(e: KeyboardEvent) {
	if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
		e.preventDefault()
		submit()
	}
}

async function addFiles(files: FileList | File[]) {
	for (const f of Array.from(files)) {
		if (!f.type.startsWith('image/')) {
			toasts.error(`${f.name} is not an image. Hermes' chat API accepts images only.`)
			continue
		}
		if (f.size > MAX_BYTES) {
			toasts.error(`${f.name} is larger than 6 MB.`)
			continue
		}
		images.value.push(
			await new Promise<string>((res) => {
				const r = new FileReader()
				r.onload = () => res(r.result as string)
				r.readAsDataURL(f)
			}),
		)
	}
}

function onPaste(e: ClipboardEvent) {
	const files = [...(e.clipboardData?.files ?? [])]
	if (files.length) {
		e.preventDefault()
		addFiles(files)
	}
}

function onDrop(e: DragEvent) {
	dragging.value = false
	if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
}

defineExpose({ focus: () => area.value?.focus() })
</script>

<template>
	<form
		class="rounded-2xl border bg-surface shadow-sm transition-colors focus-within:border-focus"
		:class="dragging ? 'border-gold' : 'border-line'"
		@submit.prevent="submit"
		@dragover.prevent="dragging = true"
		@dragleave="dragging = false"
		@drop.prevent="onDrop"
	>
		<div v-if="images.length" class="flex flex-wrap gap-2 px-3 pt-3">
			<div v-for="(img, i) in images" :key="i" class="relative">
				<img :src="img" alt="Attached image" class="size-16 rounded-md border border-line object-cover" />
				<button
					type="button"
					class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-bg"
					aria-label="Remove image"
					@click="images.splice(i, 1)"
				>
					<X :size="12" />
				</button>
			</div>
		</div>
		<textarea
			ref="area"
			v-model="text"
			rows="1"
			class="block max-h-80 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
			:placeholder="placeholder ?? 'Message Hermes'"
			:autofocus="autofocus"
			aria-label="Message"
			@keydown="onKey"
			@paste="onPaste"
		/>
		<div class="flex items-center justify-between gap-2 px-2 pb-2">
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="icon-btn"
					aria-label="Attach image"
					title="Attach image"
					@click="fileInput?.click()"
				>
					<ImagePlus :size="18" />
				</button>
				<input
					ref="fileInput"
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					@change="
						addFiles(($event.target as HTMLInputElement).files ?? [])
						;($event.target as HTMLInputElement).value = ''
					"
				/>
				<span v-if="running" class="px-1 text-xs text-ink-3">Messages you send now redirect the running agent</span>
			</div>
			<div class="flex items-center gap-1.5">
				<button
					v-if="running"
					type="button"
					class="icon-btn border border-line"
					aria-label="Stop"
					title="Stop"
					@click="emit('stop')"
				>
					<Square :size="14" fill="currentColor" />
				</button>
				<button
					type="submit"
					class="grid size-8 place-items-center rounded-full bg-ink text-bg transition-opacity disabled:opacity-30"
					:disabled="disabled || (!text.trim() && !images.length)"
					aria-label="Send"
				>
					<ArrowUp :size="17" />
				</button>
			</div>
		</div>
	</form>
</template>
