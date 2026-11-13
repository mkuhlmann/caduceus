import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { onRpcEvent, rpc } from '@/lib/rpc'
import { onResync } from '@/lib/live'

/**
 * Group chats: rooms where several bots and the user talk together. Hermes' gateway hosts and drives them (it
 * keeps running when no client is open), and Caduceus reaches them over the Hermes socket with the same
 * `groups.*` methods Hermes Desktop uses. A room's log only grows; an open room reads what is new whenever Hermes
 * pushes `groups.changed`, with a slow poll as a backstop.
 */

export type RoomMember = { member_id: string; profile: string; handle: string; display_name?: string }
export type Room = {
	room_id: string
	name: string
	members: RoomMember[]
	authority_epoch?: number
	latest_seq?: number
	updated_at?: number
	disbanded_at?: number | null
}
export type RoomEvent = {
	seq: number
	event_id?: string
	kind: string
	actor?: { kind?: string; id?: string; display_name?: string; profile?: string }
	payload: Record<string, any>
	created_at?: number
}
export type PendingAction = {
	kind: string
	member_id: string
	task_id: string
	execution_generation: number
	request_id?: string
	approval?: { request_id?: string; prompt_id?: string; command?: string; description?: string; choices?: string[] }
}
export type DriverStatus = {
	running?: boolean
	working?: boolean
	blocked?: boolean
	pending_actions?: PendingAction[]
	member_activity?: { member_id: string; status: string; thread_id?: string; round_index?: number }[]
	last_error?: string | null
	max_rounds?: number
	max_continues?: number
	routing_modes?: string[]
}
export type RoomContext = {
	purpose: string
	notes: string
	routing?: 'everyone' | 'lead' | 'auto'
	lead_member_id?: string
}
/** `change_events`: the backend pushes groups.changed for this room. Rooms reached through the dashboard leave it
 *  out (that process cannot see the owning gateway's live status), so their views keep the 2 s poll. */
type RoomState = { room: Room; context?: RoomContext; driver_status?: DriverStatus; change_events?: boolean }

type Open = { state: RoomState | null; events: RoomEvent[]; epoch?: number; error: string; loading: boolean }

const PROFILE = 'default'
const SEEN_KEY = 'caduceus.roomSeen'

export const useGroups = defineStore('groups', () => {
	const rooms = ref<Room[]>([])
	const loaded = ref(false)
	const available = ref<boolean | null>(null)
	const error = ref('')
	const open = reactive<Record<string, Open>>({})
	/** The newest event per room, for previews and "needs you", read from its log tail. */
	const tails = reactive<Record<string, RoomEvent[]>>({})
	let listInflight: Promise<void> | null = null

	const call = <T = any>(method: string, params: Record<string, unknown> = {}) =>
		rpc<T>(method, { ...params, profile: PROFILE })

	function load(): Promise<void> {
		listInflight ??= (async () => {
			try {
				const caps = await call<{ driver?: boolean; methods?: string[] }>('groups.capabilities')
				available.value = caps.driver === true && !!caps.methods?.includes('groups.create')
				const out: Room[] = []
				let offset = 0
				for (;;) {
					const page = await call<{ rooms: Room[]; next_offset: number | null }>('groups.list', { limit: 100, offset })
					out.push(...page.rooms)
					if (page.next_offset === null || page.next_offset <= offset) break
					offset = page.next_offset
				}
				rooms.value = out.filter((r) => !r.disbanded_at)
				error.value = ''
				loaded.value = true
				await Promise.all(rooms.value.map((r) => readTail(r.room_id)))
				for (const r of rooms.value) if (seen.value[r.room_id] === undefined) markSeen(r.room_id)
			} catch (e) {
				error.value = (e as Error).message
			} finally {
				listInflight = null
			}
		})()
		return listInflight
	}

	async function readTail(roomId: string) {
		try {
			const st = await call<RoomState>('groups.state', { room_id: roomId })
			const latest = st.room.latest_seq ?? 0
			const page = await call<{ events: RoomEvent[] }>('groups.log', {
				room_id: roomId,
				since_seq: Math.max(0, latest - 20),
				limit: 40,
			})
			tails[roomId] = page.events
			const i = rooms.value.findIndex((r) => r.room_id === roomId)
			if (i >= 0) rooms.value[i] = { ...rooms.value[i]!, ...st.room }
			if (open[roomId]) open[roomId].state = st
			else liveStatus[roomId] = st.driver_status ?? null
		} catch {}
	}

	/** Driver status of rooms that are not open, for the roster's working faces. */
	const liveStatus = reactive<Record<string, DriverStatus | null>>({})

	function byId(id: string) {
		return rooms.value.find((r) => r.room_id === id)
	}

	/** Open a room: read its state and its whole log, then keep both current while it is shown. */
	async function openRoom(roomId: string) {
		open[roomId] ??= { state: null, events: [], error: '', loading: true }
		await refresh(roomId)
	}

	const refreshing = new Map<string, Promise<void>>()
	function refresh(roomId: string): Promise<void> {
		const running = refreshing.get(roomId)
		if (running) return running.then(() => refresh(roomId))
		const p = (async () => {
			open[roomId] ??= { state: null, events: [], error: '', loading: true }
			// Read back through the reactive map: the object just assigned is not the proxy that renders.
			const o = open[roomId]!
			try {
				const st = await call<RoomState>('groups.state', { room_id: roomId })
				// A new authority epoch (the room re-hosted) starts the log over.
				let events = st.room.authority_epoch !== o.epoch ? [] : o.events
				let cursor = events.at(-1)?.seq ?? 0
				const latest = st.room.latest_seq ?? Infinity
				const pages: RoomEvent[] = []
				while (cursor < latest) {
					const page = await call<{ events: RoomEvent[]; has_more?: boolean }>('groups.log', {
						room_id: roomId,
						since_seq: cursor,
						limit: 100,
					})
					const fresh = page.events.filter((e) => e.seq > cursor)
					if (!fresh.length) break
					pages.push(...fresh)
					cursor = fresh.at(-1)!.seq
					if (!page.has_more) break
				}
				if (pages.length) events = events.concat(pages)
				o.state = st
				o.events = events
				o.epoch = st.room.authority_epoch
				o.error = ''
				tails[roomId] = events.slice(-40)
				const i = rooms.value.findIndex((r) => r.room_id === roomId)
				if (i >= 0) rooms.value[i] = { ...rooms.value[i]!, ...st.room }
			} catch (e) {
				o.error = (e as Error).message
			} finally {
				o.loading = false
				refreshing.delete(roomId)
			}
		})()
		refreshing.set(roomId, p)
		return p
	}

	// Hermes names the rooms that moved; an open one reads its delta, the roster its tail. Rooms reached through
	// the dashboard do not push, so the roster also re-reads every 15 s while the page is visible.
	let unsubscribe: (() => void) | null = null
	// Coming back to the app: rooms changed while it was away, and the open ones moved on.
	onResync(() => {
		if (!loaded.value) return
		void load()
		for (const id of Object.keys(open)) void refresh(id)
	})

	function listen() {
		if (unsubscribe) return
		const off = onRpcEvent('groups.changed', (payload: { room_ids?: string[] | null } | null) => {
			const ids = payload?.room_ids ?? rooms.value.map((r) => r.room_id)
			for (const id of ids) {
				if (open[id]) void refresh(id)
				else if (byId(id)) void readTail(id)
				else void load()
			}
		})
		const timer = setInterval(() => {
			if (!document.hidden && loaded.value) void load()
		}, 15_000)
		unsubscribe = () => {
			off()
			clearInterval(timer)
		}
	}

	function close(roomId: string) {
		delete open[roomId]
	}

	async function create(name: string, profiles: { profile: string; handle: string }[], purpose?: string) {
		const room_id = crypto.randomUUID()
		const members = profiles.map((p) => ({
			member_id: p.profile,
			profile: p.profile,
			handle: p.handle,
			target: { kind: 'local', profile: p.profile },
		}))
		const r = await call<{ room: Room }>('groups.create', { room_id, name: name.trim(), members })
		rooms.value = [r.room, ...rooms.value.filter((x) => x.room_id !== r.room.room_id)]
		if (purpose?.trim())
			await call('groups.context', { room_id, event_id: crypto.randomUUID(), purpose: purpose.trim(), notes: '' })
		return r.room
	}

	/** Post the user's message. A new message starts its own thread unless it replies in one. */
	async function send(roomId: string, text: string, threadId?: string) {
		const event_id = crypto.randomUUID()
		const r = await call<{ event: RoomEvent; accepted?: boolean }>('groups.send', {
			room_id: roomId,
			event_id,
			payload: { text, thread_id: threadId ?? event_id },
		})
		const o = open[roomId]
		if (o && r.event && !o.events.some((e) => e.seq === r.event.seq)) o.events = [...o.events, r.event]
		markSeen(roomId)
		void refresh(roomId)
		return r
	}

	const stop = (roomId: string) =>
		call<{ cancelled: number }>('groups.stop', { room_id: roomId, cancel_id: crypto.randomUUID() }).finally(() =>
			refresh(roomId),
		)
	const resume = (roomId: string, discussionEventId: string) =>
		call('groups.continue', { room_id: roomId, discussion_event_id: discussionEventId }).finally(() => refresh(roomId))
	const answer = (roomId: string, a: PendingAction, choice: string) =>
		call(a.kind === 'retry' ? 'groups.retry' : 'groups.approve', {
			room_id: roomId,
			member_id: a.member_id,
			task_id: a.task_id,
			execution_generation: a.execution_generation,
			...(a.kind === 'retry' ? {} : { choice, request_id: a.approval?.request_id ?? a.request_id ?? '' }),
		}).finally(() => refresh(roomId))

	async function rename(roomId: string, name: string) {
		const r = await call<{ room: Room }>('groups.rename', { room_id: roomId, event_id: crypto.randomUUID(), name })
		const i = rooms.value.findIndex((x) => x.room_id === roomId)
		if (i >= 0) rooms.value[i] = { ...rooms.value[i]!, ...r.room }
		await refresh(roomId)
	}

	async function setContext(roomId: string, ctx: RoomContext) {
		await call('groups.context', {
			room_id: roomId,
			event_id: crypto.randomUUID(),
			purpose: ctx.purpose,
			notes: ctx.notes,
			routing: ctx.routing ?? 'everyone',
			lead_member_id: ctx.routing === 'lead' ? (ctx.lead_member_id ?? '') : '',
		})
		await refresh(roomId)
	}

	/** Ends the room for good: its log stays in Hermes, but no client can open it again. */
	async function disband(roomId: string) {
		const r = await call<{ tombstone?: { room_id?: string; disbanded_at?: number } }>('groups.disband', {
			room_id: roomId,
			cancel_id: crypto.randomUUID(),
		})
		if (r?.tombstone?.room_id !== roomId) throw new Error('Hermes did not confirm the group chat ended.')
		rooms.value = rooms.value.filter((x) => x.room_id !== roomId)
		delete open[roomId]
		delete tails[roomId]
	}

	// Read state per browser, as for bots.
	const seen = ref<Record<string, number>>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}'))
	function markSeen(roomId: string) {
		const last = (open[roomId]?.events ?? tails[roomId] ?? []).at(-1)?.seq ?? 0
		if ((seen.value[roomId] ?? -1) < last) {
			seen.value = { ...seen.value, [roomId]: last }
			localStorage.setItem(SEEN_KEY, JSON.stringify(seen.value))
		}
	}

	function lastMessage(roomId: string) {
		return [...(open[roomId]?.events ?? tails[roomId] ?? [])]
			.reverse()
			.find((e) => e.kind === 'message.member' || e.kind === 'message.user')
	}

	function unread(roomId: string) {
		const last = lastMessage(roomId)
		// A room this browser never looked at counts as read from the start, so old rooms do not all light up.
		if (seen.value[roomId] === undefined) return false
		return !!last && last.seq > seen.value[roomId]! && last.kind === 'message.member'
	}

	/** A bot handed something to the user (`@user`), or a command waits for approval. */
	function needsYou(roomId: string) {
		const status = open[roomId]?.state?.driver_status ?? liveStatus[roomId]
		if (status?.pending_actions?.some((a) => a.kind === 'approval')) return true
		const events = open[roomId]?.events ?? tails[roomId] ?? []
		let lastUser = 0
		let lastAsk = 0
		for (const e of events) {
			if (e.kind === 'message.user') lastUser = e.seq
			if (e.kind === 'message.member' && /(^|\s)@user\b/i.test(String(e.payload.text ?? ''))) lastAsk = e.seq
		}
		return lastAsk > lastUser
	}

	function statusOf(roomId: string): DriverStatus | null {
		return open[roomId]?.state?.driver_status ?? liveStatus[roomId] ?? null
	}

	const sorted = computed(() =>
		[...rooms.value].sort(
			(a, b) =>
				(lastMessage(b.room_id)?.created_at ?? b.updated_at ?? 0) -
				(lastMessage(a.room_id)?.created_at ?? a.updated_at ?? 0),
		),
	)

	return {
		rooms: sorted,
		loaded,
		available,
		error,
		open,
		load,
		listen,
		byId,
		openRoom,
		refresh,
		close,
		create,
		send,
		stop,
		resume,
		answer,
		rename,
		setContext,
		disband,
		markSeen,
		unread,
		needsYou,
		lastMessage,
		statusOf,
	}
})
