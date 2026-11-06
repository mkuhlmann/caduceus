<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import Skeleton from '@/components/Skeleton.vue'
import { dashboard } from '@/lib/dashboard'
import { renderMarkdown, handleCodeCopy } from '@/lib/markdown'
import { useResource } from '@/lib/resource'
import { useToasts } from '@/stores/toast'
import { parseSkill } from './frontmatter'

const props = defineProps<{ name: string }>()
const emit = defineEmits<{ close: [] }>()
const toasts = useToasts()

const res = useResource(
	() => `skills:content:${props.name}`,
	() => dashboard.skillContent(props.name),
)
const content = computed(() => res.data.value?.content ?? '')
const path = computed(() => res.data.value?.path ?? '')
const loading = computed(() => res.pending.value)
const error = computed(() => (res.data.value ? '' : res.error.value))
const draft = ref('')
const editing = ref(false)
const saving = ref(false)

const parsed = computed(() => parseSkill(content.value))
const html = computed(() => renderMarkdown(parsed.value.body))

function edit() {
	draft.value = content.value
	editing.value = true
}

async function save() {
	saving.value = true
	try {
		await dashboard.saveSkillContent(props.name, draft.value)
		res.mutate((d) => (d ? { ...d, content: draft.value } : d))
		editing.value = false
		toasts.push('Skill saved')
	} catch (e) {
		toasts.error(`Could not save the skill. ${(e as Error).message}`)
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<Modal :title="parsed.meta.name || name" wide @close="emit('close')">
		<p v-if="error" class="text-rose">Could not load this skill. {{ error }}</p>
		<Skeleton v-else-if="loading" variant="lines" :count="8" label="Loading skill" />
		<template v-else-if="editing">
			<label class="label" for="skill-src">SKILL.md</label>
			<textarea id="skill-src" v-model="draft" class="field min-h-[50vh] font-mono text-xs" spellcheck="false" />
			<p class="mt-1 text-xs text-ink-3">The frontmatter at the top needs a name and a description.</p>
		</template>
		<template v-else>
			<p v-if="parsed.meta.description" class="mb-4 max-w-[72ch] text-ink-2">{{ parsed.meta.description }}</p>
			<div class="prose-h" @click="handleCodeCopy" v-html="html" />
			<p v-if="path" class="mt-6 break-all font-mono text-xs text-ink-3">{{ path }}</p>
		</template>
		<template #footer>
			<template v-if="editing">
				<button class="btn-ghost" :disabled="saving" @click="editing = false">Cancel</button>
				<button class="btn-primary" :disabled="saving" @click="save">Save skill</button>
			</template>
			<template v-else>
				<button class="btn-outline" :disabled="loading || !!error" @click="edit">Edit</button>
				<button class="btn-ghost" @click="emit('close')">Close</button>
			</template>
		</template>
	</Modal>
</template>
