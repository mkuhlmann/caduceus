<script lang="ts">
// In-memory drafts per chat, so switching chats doesn't carry over typed text or images.
const drafts = new Map<string, { text: string; images: string[] }>()
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Square, ImagePlus, X } from 'lucide-vue-next'
import { useToasts } from '@/stores/toast'
import BotAvatar from '@/components/bots/BotAvatar.vue'
import { mentionCandidates, mentionTag, typedMention, type MentionTarget } from '@/lib/mentions'
import type { BotLook } from '@/lib/avatar'

/** A bot the composer can @mention, with what it needs to show its face in the list. */
export type MentionBot = MentionTarget & { look?: BotLook | null; image?: string | null }
/** A tag that is not a bot, like `@all` in a group chat. */
export type MentionExtra = { tag: string; label: string }

const props = defineProps<{
	running?: boolean
	disabled?: boolean
	placeholder?: string
	autofocus?: boolean
	draftKey?: string
	/** Bots `@` offers; the one being talked to is left out. */
	mentions?: MentionBot[]
	activeBot?: string
	extraMentions?: MentionExtra[]
	/** Group chats take text only. */
	noImages?: boolean
	/** Fill for the send button, e.g. the bot's colour in its chat; it must carry white text. */
	accent?: string
}>()
const emit = defineEmits<{ send: [text: string, images: string[]]; stop: [] }>()
const toasts = useToasts()
const text = ref('')
const images = ref<string[]>([])
const area = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)

// @mention autocomplete: typing "@res" offers the bots whose tags start with (or contain) it.
const typed = ref<{ start: number; query: string } | null>(null)
const pick = ref(0)
type Option = { tag: string; label: string; bot?: MentionBot }
const options = computed<Option[]>(() => {
	if (!typed.value) return []
	const q = typed.value.query
	const extras = (props.extraMentions ?? []).filter((x) => x.tag.startsWith(q)).map((x) => ({ ...x }))
	const bots = mentionCandidates(q, props.mentions ?? [], props.activeBot).map((b) => ({
		tag: mentionTag(b),
		label: b.displayName,
		bot: b as MentionBot,
	}))
	return [...bots, ...extras].slice(0, 8)
})
watch(options, () => (pick.value = 0))

function updateTyped() {
	const el = area.value
	if (!el || (!props.mentions?.length && !props.extraMentions?.length)) return (typed.value = null)
	typed.value = typedMention(text.value, el.selectionStart ?? text.value.length)
}

function choose(o: Option) {
	const el = area.value
	if (!el || !typed.value) return
	const caret = el.selectionStart ?? text.value.length
	const insert = `@${o.tag} `
	const pos = typed.value.start + insert.length
	text.value = text.value.slice(0, typed.value.start) + insert + text.value.slice(caret)
	typed.value = null
	nextTick(() => {
		el.focus()
		el.setSelectionRange(pos, pos)
	})
}

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
	if (options.value.length) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			const n = options.value.length
			pick.value = (pick.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
			return
		}
		if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
			e.preventDefault()
			choose(options.value[pick.value]!)
			return
		}
		if (e.key === 'Escape') {
			e.preventDefault()
			typed.value = null
			return
		}
	}
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

/** Start the draft with `prefix` (e.g. `@handle `), keeping what is typed after it, and put the caret at the end. */
function seed(prefix: string) {
	const rest = text.value.replace(/^@[a-z0-9_-]+\s+/i, '')
	text.value = prefix + rest
	nextTick(() => {
		area.value?.focus()
		area.value?.setSelectionRange(text.value.length, text.value.length)
	})
}

defineExpose({ focus: () => area.value?.focus(), seed })
</script>

<template>
	<form
		class="relative rounded-2xl border bg-surface shadow-sm transition-colors focus-within:border-ink-3"
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
		<ul
			v-if="options.length"
			id="mention-options"
			class="absolute bottom-full left-2 z-30 mb-2 w-72 max-w-[calc(100%-1rem)] rounded-lg border border-line bg-surface p-1 shadow-xl"
			role="listbox"
			aria-label="Mention"
		>
			<li
				v-for="(o, i) in options"
				:id="`mention-${i}`"
				:key="o.tag"
				role="option"
				:aria-selected="i === pick"
				class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
				:class="i === pick ? 'bg-surface-2' : ''"
				@mousedown.prevent="choose(o)"
				@mouseenter="pick = i"
			>
				<BotAvatar v-if="o.bot" :seed="o.bot.name" :look="o.bot.look" :image="o.bot.image" :size="22" still />
				<span v-else class="grid size-[22px] place-items-center rounded-full bg-surface-3 text-xs text-ink-2">@</span>
				<span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
				<span class="shrink-0 text-ink-3">@{{ o.tag }}</span>
			</li>
		</ul>
		<textarea
			ref="area"
			v-model="text"
			rows="1"
			class="block max-h-80 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
			:placeholder="placeholder ?? 'Message Hermes'"
			:autofocus="autofocus"
			aria-label="Message"
			:aria-autocomplete="mentions?.length ? 'list' : undefined"
			:aria-controls="options.length ? 'mention-options' : undefined"
			:aria-activedescendant="options.length ? `mention-${pick}` : undefined"
			@keydown="onKey"
			@input="updateTyped"
			@click="updateTyped"
			@keyup.left="updateTyped"
			@keyup.right="updateTyped"
			@blur="typed = null"
			@paste="onPaste"
		/>
		<div class="flex items-center justify-between gap-2 px-2 pb-2">
			<div class="flex items-center gap-1">
				<button
					v-if="!noImages"
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
					class="grid size-8 place-items-center rounded-full transition-opacity disabled:opacity-30"
					:class="accent ? 'text-white' : 'bg-ink text-bg'"
					:style="accent ? { background: accent } : undefined"
					:disabled="disabled || (!text.trim() && !images.length)"
					aria-label="Send"
				>
					<ArrowUp :size="17" />
				</button>
			</div>
		</div>
	</form>
</template>
