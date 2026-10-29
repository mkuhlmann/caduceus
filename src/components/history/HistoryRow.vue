<script setup lang="ts">
import { computed } from 'vue'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-vue-next'
import { sourceLabel } from '@/stores/sessions'
import { relative, dateTime } from '@/lib/time'

export type HistoryItem = {
	id: string
	title?: string | null
	preview?: string
	source?: string
	model?: string
	last_active?: number
	message_count?: number
	is_active?: boolean
	archived?: boolean
	snippet?: string
}

const props = defineProps<{ item: HistoryItem; busy?: boolean }>()
const emit = defineEmits<{ open: []; archive: []; remove: [] }>()

const name = computed(
	() =>
		props.item.title ||
		props.item.preview?.trim() ||
		(props.item.source === 'cron' ? 'Scheduled run' : 'Untitled chat'),
)

/** Split a snippet on the >>>match<<< markers. Rendered as text nodes, so no HTML is ever injected. */
const parts = computed(() => {
	const out: { text: string; hit: boolean }[] = []
	// Snippets often come from raw tool output: undo JSON escaping and collapse whitespace.
	const s = props.item.snippet
		?.replace(/\\+[nrt]/g, ' ')
		.replace(/\\+(["'\/])/g, '$1')
		.replace(/\s+/g, ' ')
		.trim()
	if (!s) return out
	let rest = s
	while (rest) {
		const a = rest.indexOf('>>>')
		if (a < 0) {
			out.push({ text: rest, hit: false })
			break
		}
		const b = rest.indexOf('<<<', a + 3)
		if (b < 0) {
			out.push({ text: rest.replace(/>>>|<<</g, ''), hit: false })
			break
		}
		if (a > 0) out.push({ text: rest.slice(0, a), hit: false })
		out.push({ text: rest.slice(a + 3, b), hit: true })
		rest = rest.slice(b + 3)
	}
	return out
})

const count = computed(() => {
	const n = props.item.message_count
	return n == null ? '' : n === 0 ? 'No messages' : `${n.toLocaleString()} ${n === 1 ? 'message' : 'messages'}`
})
</script>

<template>
	<li class="group relative flex items-start gap-1 px-2 py-2.5 hover:bg-surface-2/50 sm:px-3">
		<button class="min-w-0 flex-1 rounded-md text-left" @click="emit('open')">
			<span class="flex items-center gap-2">
				<span
					v-if="item.is_active"
					class="size-2 shrink-0 animate-pulse rounded-full bg-gold"
					title="The agent is working on this now"
				/>
				<span class="truncate font-medium text-ink">{{ name }}</span>
				<span v-if="item.archived" class="chip shrink-0">Archived</span>
			</span>
			<span v-if="parts.length" class="mt-1 line-clamp-2 break-words text-sm text-ink-2">
				<template v-for="(p, i) in parts" :key="i">
					<mark v-if="p.hit" class="rounded-sm bg-surface-3 px-0.5 font-medium text-ink">{{ p.text }}</mark>
					<template v-else>{{ p.text }}</template>
				</template>
			</span>
			<span class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
				<span v-if="item.source">{{ sourceLabel(item.source) }}</span>
				<time v-if="item.last_active" :title="dateTime(item.last_active)">{{ relative(item.last_active) }}</time>
				<span v-if="count">{{ count }}</span>
				<span v-if="item.model">{{ item.model }}</span>
			</span>
		</button>
		<div class="flex shrink-0 items-center">
			<button
				class="icon-btn"
				:disabled="busy"
				:aria-label="item.archived ? `Restore ${name}` : `Archive ${name}`"
				:title="item.archived ? 'Restore' : 'Archive'"
				@click="emit('archive')"
			>
				<ArchiveRestore v-if="item.archived" :size="16" />
				<Archive v-else :size="16" />
			</button>
			<button
				class="icon-btn hover:text-rose"
				:disabled="busy"
				:aria-label="`Delete ${name}`"
				title="Delete"
				@click="emit('remove')"
			>
				<Trash2 :size="16" />
			</button>
		</div>
	</li>
</template>
