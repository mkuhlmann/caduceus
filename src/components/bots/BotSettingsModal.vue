<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import LookPicker from './LookPicker.vue'
import ModelSelect from './ModelSelect.vue'
import CapabilitiesEditor from './CapabilitiesEditor.vue'
import { dashboard } from '@/lib/dashboard'
import { resolveLook, type BotLook } from '@/lib/avatar'
import { prettyName, useBots, type Bot } from '@/stores/bots'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'

const props = defineProps<{ bot: Bot }>()
const emit = defineEmits<{ close: [] }>()
const bots = useBots()
const toasts = useToasts()
const dialogs = useDialogs()
const router = useRouter()

const look = ref<BotLook>(resolveLook(props.bot.name, props.bot.look))
const image = ref<string | null>(props.bot.image)
const title = ref(props.bot.title)
const description = ref(props.bot.description)
const current = { provider: props.bot.provider, model: props.bot.model }
const currentModel = current.model ? `${current.provider}::${current.model}` : ''
const model = ref(currentModel)
const soul = ref('')
const soulLoaded = ref(false)
const soulError = ref('')
let soulAtStart = ''
const busy = ref(false)
const tab = ref<'general' | 'capabilities'>('general')
// Mounted on first visit and kept, so switching tabs never drops ticked boxes.
const capsVisited = ref(false)
const caps = ref<InstanceType<typeof CapabilitiesEditor>>()
function show(t: 'general' | 'capabilities') {
	tab.value = t
	if (t === 'capabilities') capsVisited.value = true
}

onMounted(async () => {
	try {
		soul.value = soulAtStart = await dashboard.profileSoul(props.bot.name)
		soulLoaded.value = true
	} catch (e) {
		soulError.value = (e as Error).message
	}
})

const lookChanged = computed(
	() => JSON.stringify(look.value) !== JSON.stringify(resolveLook(props.bot.name, props.bot.look)) || !props.bot.look,
)

async function save() {
	busy.value = true
	try {
		await bots.update(props.bot.name, {
			...(title.value.trim() !== props.bot.title ? { title: title.value.trim() } : {}),
			...(lookChanged.value ? { look: look.value } : {}),
			...(image.value !== props.bot.image ? { image: image.value } : {}),
			...(description.value.trim() !== props.bot.description ? { description: description.value.trim() } : {}),
			...(soulLoaded.value && soul.value !== soulAtStart ? { soul: soul.value } : {}),
		})
		await caps.value?.save()
		if (model.value && model.value !== currentModel) {
			const [provider, m] = model.value.split('::')
			await dashboard.setProfileModel(props.bot.name, provider!, m!)
			await bots.load()
		}
		toasts.push('Bot saved')
		emit('close')
	} catch (e) {
		toasts.error(`Could not save the bot. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}

async function remove() {
	const ok = await dialogs.confirm({
		title: `Delete ${props.bot.displayName}?`,
		body: 'Its profile on the Hermes host goes too: memory, skills, chats and settings.',
		action: 'Delete bot',
		danger: true,
	})
	if (!ok) return
	busy.value = true
	try {
		await bots.remove(props.bot.name)
		toasts.push('Bot deleted')
		emit('close')
		router.push('/bots')
	} catch (e) {
		toasts.error(`Could not delete the bot. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal :title="`${bot.displayName} settings`" @close="emit('close')">
		<div class="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Settings sections">
			<button
				v-for="t in [
					{ id: 'general', label: 'General' },
					{ id: 'capabilities', label: 'Capabilities' },
				] as const"
				:key="t.id"
				type="button"
				role="tab"
				:aria-selected="tab === t.id"
				class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
				:class="tab === t.id ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'"
				@click="show(t.id)"
			>
				{{ t.label }}
			</button>
		</div>
		<div v-if="capsVisited" v-show="tab === 'capabilities'">
			<CapabilitiesEditor ref="caps" :name="bot.name" />
		</div>
		<form v-show="tab === 'general'" id="bot-settings" class="flex flex-col gap-4" @submit.prevent="save">
			<div>
				<p class="label">Look</p>
				<LookPicker v-model:look="look" v-model:image="image" :seed="bot.name" :alt="bot.displayName" />
			</div>
			<div>
				<label class="label" for="bs-title">Display name</label>
				<input
					id="bs-title"
					v-model="title"
					class="field"
					:placeholder="bot.isDefault ? 'Hermes' : prettyName(bot.name)"
					maxlength="80"
				/>
				<p class="mt-1 text-sm text-ink-3">
					How the bot appears on screen. Hermes calls this its title; the handle stays @{{ bot.handle }}.
				</p>
			</div>
			<div>
				<label class="label" for="bs-desc">Description</label>
				<textarea id="bs-desc" v-model="description" class="field" rows="2" />
				<p class="mt-1 text-sm text-ink-3">Hermes also uses this to decide which bot gets a task.</p>
			</div>
			<div>
				<label class="label" for="bs-model">Model</label>
				<ModelSelect
					id="bs-model"
					v-model="model"
					:current="current"
					:empty-label="current.model ? 'Keep the current model' : 'Not set'"
				/>
			</div>
			<div>
				<label class="label" for="bs-soul">SOUL.md</label>
				<p v-if="soulError" class="text-sm text-rose">Could not load SOUL.md. {{ soulError }}</p>
				<textarea
					v-else
					id="bs-soul"
					v-model="soul"
					class="field"
					rows="8"
					:disabled="!soulLoaded"
					:placeholder="soulLoaded ? 'Who the bot is and how it works.' : ''"
				/>
			</div>
		</form>
		<template #footer>
			<button v-if="!bot.isDefault" class="btn-danger mr-auto" type="button" :disabled="busy" @click="remove">
				Delete bot
			</button>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="bot-settings" :disabled="busy">Save changes</button>
		</template>
	</Modal>
</template>
