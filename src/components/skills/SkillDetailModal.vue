<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { dashboard } from '@/lib/dashboard'
import { renderMarkdown, handleCodeCopy } from '@/lib/markdown'
import { useToasts } from '@/stores/toast'
import { parseSkill } from './frontmatter'

const props = defineProps<{ name: string }>()
const emit = defineEmits<{ close: [] }>()
const toasts = useToasts()

const content = ref('')
const path = ref('')
const draft = ref('')
const editing = ref(false)
const loading = ref(true)
const error = ref('')
const saving = ref(false)

const parsed = computed(() => parseSkill(content.value))
const html = computed(() => renderMarkdown(parsed.value.body))

onMounted(async () => {
	try {
		const r = await dashboard.skillContent(props.name)
		content.value = r.content
		path.value = r.path
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		loading.value = false
	}
})

function edit() {
	draft.value = content.value
	editing.value = true
}

async function save() {
	saving.value = true
	try {
		await dashboard.saveSkillContent(props.name, draft.value)
		content.value = draft.value
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
		<p v-if="loading" class="text-ink-2">Loading skill...</p>
		<p v-else-if="error" class="text-rose">Could not load this skill. {{ error }}</p>
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
