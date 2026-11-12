<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import LookPicker from './LookPicker.vue'
import ModelSelect from './ModelSelect.vue'
import { generatedLook, type BotLook } from '@/lib/avatar'
import { prettyName, useBots } from '@/stores/bots'
import { useSessions } from '@/stores/sessions'
import { useToasts } from '@/stores/toast'

const emit = defineEmits<{ close: [] }>()
const bots = useBots()
const sessions = useSessions()
const toasts = useToasts()
const router = useRouter()

const name = ref('')
const title = ref('')
const description = ref('')
const chosenLook = ref<BotLook | null>(null)
const image = ref<string | null>(null)
const cloneFrom = ref('default')
const model = ref('')
const soul = ref('')
const noSkills = ref(false)
const busy = ref(false)

const handle = computed(() => name.value.trim().toLowerCase())
const validName = computed(() => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(handle.value) && handle.value !== 'default')
const taken = computed(() => bots.bots.some((b) => b.name === handle.value))
// The face follows the name until the user picks one.
const look = computed<BotLook>({
	get: () => chosenLook.value ?? generatedLook(handle.value || 'new'),
	set: (v) => (chosenLook.value = v),
})
const others = computed(() => bots.bots.filter((b) => !b.isDefault))

async function submit() {
	if (!validName.value || taken.value) return
	busy.value = true
	try {
		const [provider, m] = model.value ? model.value.split('::') : []
		const created = await bots.create({
			name: handle.value,
			title: title.value.trim(),
			description: description.value.trim(),
			look: look.value,
			image: image.value,
			cloneFrom: cloneFrom.value,
			noSkills: !cloneFrom.value && noSkills.value,
			provider,
			model: m,
			soul: soul.value.trim() || undefined,
		})
		toasts.push('Bot created')
		emit('close')
		router.push(`/bots/${encodeURIComponent(created)}`)
		// A new bot introduces itself as the first message of its Bot Chat, as in Hermes Desktop.
		bots
			.ensureChat(created)
			.then((id) => sessions.send(id, 'Hey, tell me about yourself!'))
			.catch(() => {})
	} catch (e) {
		toasts.error(`Could not create the bot. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="New bot" @close="emit('close')">
		<form id="new-bot" class="flex flex-col gap-4" @submit.prevent="submit">
			<div>
				<label class="label" for="nb-name">Name</label>
				<input
					id="nb-name"
					v-model="name"
					class="field"
					placeholder="researcher"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					required
				/>
				<p v-if="name && !validName" class="mt-1 text-sm text-rose">
					Use lowercase letters, digits, - and _, starting with a letter or digit.
				</p>
				<p v-else-if="taken" class="mt-1 text-sm text-rose">A bot with this name already exists.</p>
				<p v-else class="mt-1 text-sm text-ink-3">Its handle in Hermes, as in @{{ handle || 'researcher' }}.</p>
			</div>
			<div>
				<label class="label" for="nb-title">Display name</label>
				<input
					id="nb-title"
					v-model="title"
					class="field"
					:placeholder="handle ? prettyName(handle) : 'Research Bot'"
					maxlength="80"
				/>
				<p class="mt-1 text-sm text-ink-3">
					How the bot appears on screen. Hermes calls this its title; the handle stays @{{ handle || 'researcher' }}.
				</p>
			</div>
			<div>
				<label class="label" for="nb-desc">Description</label>
				<textarea
					id="nb-desc"
					v-model="description"
					class="field"
					rows="2"
					placeholder="Digs through papers and sources and reports back with citations."
				/>
				<p class="mt-1 text-sm text-ink-3">Hermes also uses this to decide which bot gets a task.</p>
			</div>
			<div>
				<p class="label">Look</p>
				<LookPicker v-model:look="look" v-model:image="image" :seed="handle || 'new'" :alt="handle" />
			</div>
			<details class="group">
				<summary class="cursor-pointer text-sm font-medium text-ink-2 hover:text-ink">Advanced</summary>
				<div class="mt-3 flex flex-col gap-4">
					<div>
						<label class="label" for="nb-clone">Start from</label>
						<select id="nb-clone" v-model="cloneFrom" class="field">
							<option value="default">A copy of Hermes' settings</option>
							<option v-for="b in others" :key="b.name" :value="b.name">A copy of {{ b.displayName }}</option>
							<option value="">An empty profile</option>
						</select>
						<p class="mt-1 text-sm text-ink-3">
							{{
								cloneFrom
									? 'Copies the model, provider keys, skills and SOUL.md. Messaging channels stay with the original.'
									: 'Starts with no provider keys: add them in its settings on the Hermes host before it can answer.'
							}}
						</p>
					</div>
					<label v-if="!cloneFrom" class="flex items-center gap-2 text-sm">
						<input v-model="noSkills" type="checkbox" /> Start without the bundled skills
					</label>
					<div>
						<label class="label" for="nb-model">Model</label>
						<ModelSelect id="nb-model" v-model="model" empty-label="Same as the starting point" />
					</div>
					<div>
						<label class="label" for="nb-soul">SOUL.md</label>
						<textarea
							id="nb-soul"
							v-model="soul"
							class="field"
							rows="5"
							placeholder="Who the bot is and how it works. Leave empty to keep the starting point's."
						/>
					</div>
				</div>
			</details>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="new-bot" :disabled="busy || !validName || taken">
				Create bot
			</button>
		</template>
	</Modal>
</template>
