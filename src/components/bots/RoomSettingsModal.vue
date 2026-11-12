<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import BotAvatar from './BotAvatar.vue'
import { gwFor, type Session } from '@/lib/gateway'
import { get, post, qs } from '@/lib/http'
import { useBots } from '@/stores/bots'
import { useGroups, type Room, type RoomContext } from '@/stores/groups'
import { useToasts } from '@/stores/toast'

/** A group chat's settings: name, purpose and notes, who answers, members' history, and ending the room. */
const props = defineProps<{ room: Room; context?: RoomContext; routingModes?: string[] }>()
const emit = defineEmits<{ close: [] }>()
const groups = useGroups()
const bots = useBots()
const toasts = useToasts()
const router = useRouter()

const name = ref(props.room.name)
const purpose = ref(props.context?.purpose ?? '')
const notes = ref(props.context?.notes ?? '')
const routing = ref<'everyone' | 'lead' | 'auto'>(props.context?.routing ?? 'everyone')
const lead = ref(props.context?.lead_member_id || props.room.members[0]?.member_id || '')
const busy = ref(false)
const compressing = ref('')
const modes = props.routingModes ?? ['everyone']

async function save() {
	busy.value = true
	try {
		if (name.value.trim() && name.value.trim() !== props.room.name)
			await groups.rename(props.room.room_id, name.value.trim())
		const ctx: RoomContext = {
			purpose: purpose.value.trim(),
			notes: notes.value.trim(),
			routing: routing.value,
			lead_member_id: lead.value,
		}
		const before = props.context
		if (
			!before ||
			before.purpose !== ctx.purpose ||
			before.notes !== ctx.notes ||
			(before.routing ?? 'everyone') !== ctx.routing ||
			(ctx.routing === 'lead' && before.lead_member_id !== ctx.lead_member_id)
		)
			await groups.setContext(props.room.room_id, ctx)
		toasts.push('Group chat saved')
		emit('close')
	} catch (e) {
		toasts.error(`Could not save the group chat. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}

/**
 * Each member keeps one hidden session for the room, titled `Group: <room id>`. When it grows too large the member
 * starts answering empty; compressing it, as `/compress` would, fixes that. The room log is untouched.
 */
async function compress(profile: string) {
	compressing.value = profile
	try {
		const r = await get<{ data: Session[] }>(
			`${gwFor(profile)}/api/sessions${qs({ title: `Group: ${props.room.room_id}`, include_hidden: true })}`,
		)
		const s = r.data[0]
		if (!s) return toasts.push('This member has no room history to compress yet.')
		const c = await post<{ compressed: boolean; removed: number | null }>(
			`ui-api/bots/${encodeURIComponent(profile)}/compact`,
			{ sessionId: s.id },
		)
		toasts.push(
			c.compressed && c.removed ? `History compressed, ${c.removed} messages folded` : 'Nothing to compress yet.',
		)
	} catch (e) {
		toasts.error(`Could not compress the history. ${(e as Error).message}`)
	} finally {
		compressing.value = ''
	}
}

async function disband() {
	if (!confirm(`Disband ${props.room.name}? The group chat ends for every client and cannot be opened again.`)) return
	busy.value = true
	try {
		await groups.disband(props.room.room_id)
		toasts.push(`${props.room.name} disbanded`)
		emit('close')
		router.push('/bots')
	} catch (e) {
		toasts.error(`Could not disband the group chat. ${(e as Error).message}`)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Modal title="Group settings" @close="emit('close')">
		<form id="room-settings" class="flex flex-col gap-4" @submit.prevent="save">
			<div>
				<label class="label" for="rs-name">Name</label>
				<input id="rs-name" v-model="name" class="field" maxlength="80" required />
			</div>
			<div>
				<label class="label" for="rs-purpose">Purpose</label>
				<textarea id="rs-purpose" v-model="purpose" class="field" rows="2" placeholder="What this room is for." />
			</div>
			<div>
				<label class="label" for="rs-notes">Shared notes</label>
				<textarea
					id="rs-notes"
					v-model="notes"
					class="field"
					rows="3"
					maxlength="4096"
					placeholder="Decisions, constraints, links: every member reads them."
				/>
			</div>
			<fieldset>
				<legend class="label">Who answers a message that names nobody</legend>
				<div class="flex flex-col gap-1.5 text-sm">
					<label class="flex items-center gap-2">
						<input v-model="routing" type="radio" value="everyone" /> Everyone
					</label>
					<label v-if="modes.includes('lead')" class="flex items-center gap-2">
						<input v-model="routing" type="radio" value="lead" /> A lead, who hands it on
					</label>
					<select v-if="routing === 'lead'" v-model="lead" class="field ml-6 w-auto" aria-label="Lead">
						<option v-for="m in room.members" :key="m.member_id" :value="m.member_id">
							{{ bots.byName(m.profile)?.displayName ?? m.handle }}
						</option>
					</select>
					<label v-if="modes.includes('auto')" class="flex items-center gap-2">
						<input v-model="routing" type="radio" value="auto" /> Pick who answers automatically
					</label>
				</div>
				<p class="mt-1 text-sm text-ink-3">@mentions and @all always reach exactly who they name.</p>
			</fieldset>
			<div>
				<p class="label">Members</p>
				<ul class="divide-y divide-line rounded-lg border border-line">
					<li v-for="m in room.members" :key="m.member_id" class="flex items-center gap-3 px-3 py-2">
						<BotAvatar
							:seed="m.profile"
							:look="bots.byName(m.profile)?.look"
							:image="bots.byName(m.profile)?.image"
							:size="26"
							still
						/>
						<span class="min-w-0 flex-1 truncate text-sm">
							{{ bots.byName(m.profile)?.displayName ?? m.handle }}
							<span class="text-ink-3">@{{ m.handle }}</span>
						</span>
						<button
							type="button"
							class="btn-ghost h-7"
							:disabled="!!compressing || !bots.byName(m.profile)?.connected"
							:title="
								bots.byName(m.profile)?.connected
									? 'When a member starts answering empty, its room history has grown too large'
									: 'Connect this bot to Caduceus first'
							"
							@click="compress(m.profile)"
						>
							{{ compressing === m.profile ? 'Compressing…' : 'Compress history' }}
						</button>
					</li>
				</ul>
			</div>
		</form>
		<template #footer>
			<button class="btn-danger mr-auto" type="button" :disabled="busy" @click="disband">Disband</button>
			<button class="btn-ghost" type="button" @click="emit('close')">Cancel</button>
			<button class="btn-primary" type="submit" form="room-settings" :disabled="busy">Save changes</button>
		</template>
	</Modal>
</template>
