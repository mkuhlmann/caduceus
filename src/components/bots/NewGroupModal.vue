<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import BotAvatar from './BotAvatar.vue'
import { useBots } from '@/stores/bots'
import { useGroups } from '@/stores/groups'
import { useToasts } from '@/stores/toast'

/** Start a group chat: a name and two to six bots. Hermes' gateway runs it, also while Caduceus is closed. */
const props = defineProps<{ preselect?: string }>()
const emit = defineEmits<{ close: [] }>()
const bots = useBots()
const groups = useGroups()
const toasts = useToasts()
const router = useRouter()

const name = ref('')
const purpose = ref('')
const picked = ref<string[]>(props.preselect ? [props.preselect] : [])
const busy = ref(false)
const valid = computed(() => name.value.trim() && picked.value.length >= 2 && picked.value.length <= 6)

function toggle(n: string) {
	picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n]
}

async function submit() {
	if (!valid.value) return
	busy.value = true
	try {
		const room = await groups.create(
			name.value,
			picked.value.map((n) => ({ profile: n, handle: bots.byName(n)?.handle ?? n })),
			purpose.value,
		)
		toasts.push('Group chat created')
		emit('close')
		router.push(`/bots/rooms/${encodeURIComponent(room.room_id)}`)
	} catch (e) {
		toasts.error(`Could not create the group chat. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="New group chat" @close="emit('close')">
		<form id="new-group" class="flex flex-col gap-4" @submit.prevent="submit">
			<div>
				<label class="label" for="ng-name">Name</label>
				<input id="ng-name" v-model="name" class="field" placeholder="Renovation team" maxlength="80" required />
			</div>
			<div>
				<label class="label" for="ng-purpose">Purpose</label>
				<textarea
					id="ng-purpose"
					v-model="purpose"
					class="field"
					rows="2"
					placeholder="Plan the kitchen renovation together. Optional."
				/>
				<p class="mt-1 text-sm text-ink-3">Every bot in the room reads this before it answers.</p>
			</div>
			<fieldset>
				<legend class="label">Bots ({{ picked.length }} of 2–6)</legend>
				<ul class="divide-y divide-line rounded-lg border border-line">
					<li v-for="b in bots.bots" :key="b.name">
						<label
							class="flex cursor-pointer items-center gap-3 px-3 py-2"
							:class="{ 'opacity-50': !picked.includes(b.name) && picked.length >= 6 }"
						>
							<input
								type="checkbox"
								:checked="picked.includes(b.name)"
								:disabled="!picked.includes(b.name) && picked.length >= 6"
								@change="toggle(b.name)"
							/>
							<BotAvatar :seed="b.name" :look="b.look" :image="b.image" :size="28" still :alt="b.displayName" />
							<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ b.displayName }}</span>
							<span class="text-sm text-ink-3">@{{ b.handle }}</span>
						</label>
					</li>
				</ul>
			</fieldset>
			<p class="text-sm text-ink-3">
				Hermes runs the group chat, so it keeps going when Caduceus is closed. Your message starts up to three rounds;
				@mention bots to address only them.
			</p>
		</form>
		<template #footer>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="new-group" :disabled="busy || !valid">Create group chat</button>
		</template>
	</Modal>
</template>
