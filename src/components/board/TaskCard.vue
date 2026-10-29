<script setup lang="ts">
import { MessageSquare, TriangleAlert } from 'lucide-vue-next'
import type { KanbanTask } from '@/lib/dashboard'
import { relative } from '@/lib/time'

defineProps<{ task: KanbanTask }>()
defineEmits<{ open: [] }>()
</script>

<template>
	<button
		type="button"
		draggable="true"
		class="block w-full cursor-grab rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-surface-2 active:cursor-grabbing"
		:class="task.status === 'running' ? 'border-gold' : 'border-line'"
		@click="$emit('open')"
	>
		<div class="flex items-start gap-2">
			<span
				v-if="task.status === 'running'"
				class="mt-1.5 size-2 shrink-0 rounded-full bg-gold"
				title="An agent is working on this"
			/>
			<span class="min-w-0 flex-1 text-sm font-medium leading-snug break-words">{{ task.title }}</span>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
			<span v-if="task.assignee" class="text-ink-2">{{ task.assignee }}</span>
			<span v-else>Unassigned</span>
			<span v-if="task.priority" class="chip">Priority {{ task.priority }}</span>
			<span v-if="task.comment_count" class="inline-flex items-center gap-1" :title="`${task.comment_count} comments`">
				<MessageSquare :size="12" />{{ task.comment_count }}
			</span>
			<span v-if="task.progress && task.progress.total" :title="'Subtasks done'"
				>{{ task.progress.done }} of {{ task.progress.total }} done</span
			>
			<span
				v-if="task.last_failure_error"
				class="inline-flex items-center gap-1 text-rose"
				:title="task.last_failure_error"
			>
				<TriangleAlert :size="12" />Last run failed
			</span>
			<span class="ml-auto">{{ relative(task.created_at) }}</span>
		</div>
	</button>
</template>
