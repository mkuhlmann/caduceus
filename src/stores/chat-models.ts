import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, put } from '@/lib/http'
import { onResync } from '@/lib/live'
import { onRpcEvent } from '@/lib/rpc'
import { gateway } from '@/lib/gateway'
import { dashboard } from '@/lib/dashboard'
import { modelOptionsFor, type ChatModel, type ChatModels } from '@/lib/chat-models'
import { useSessions } from '@/stores/sessions'
import { useDialogs } from '@/stores/dialogs'
import { useBots, type Bot } from '@/stores/bots'

const enc = encodeURIComponent

/**
 * The model each chat runs on (`src/lib/chat-models.ts`): locked onto the chat in Hermes, and recorded on the relay
 * with the provider and reasoning level Hermes does not report back.
 */
export const useChatModels = defineStore('chatModels', () => {
	const sessions = useSessions()
	const dialogs = useDialogs()
	const choices = ref<ChatModels>({})
	/** Hermes can lock a chat to a model; null until known. */
	const supported = ref<boolean | null>(null)
	let loading: Promise<void> | null = null

	async function load() {
		const [c, caps] = await Promise.all([
			get<ChatModels>('ui-api/chat-models').catch(() => null),
			gateway.capabilities().catch(() => null),
		])
		if (c) choices.value = c
		if (caps) supported.value = caps.features?.session_model_lock === true
		else supported.value ??= false
	}
	/** Load once, when something first shows a chat's model. */
	const ensure = () => (loading ??= load())

	/** Lock `id` to a model from its next turn on. */
	async function apply(id: string, choice: ChatModel) {
		await gateway.setSessionModel(id, choice.provider, choice.model, modelOptionsFor(choice.reasoning))
		choices.value = { ...choices.value, [id]: choice }
		const s = sessions.byId(id)
		if (s) s.model = choice.model
		// Hermes holds the lock either way; without the record only the provider and reasoning shown here are lost.
		await put(`ui-api/chat-models/${enc(id)}`, choice).catch(() => {})
	}

	/**
	 * Set the default model, Hermes' own or a bot's (`profile`), asking first when Hermes warns the model is
	 * expensive. False when the user declined.
	 */
	async function setDefault(provider: string, model: string, profile?: string) {
		let r = await dashboard.setModel(provider, model, { profile })
		if (!r.ok && r.confirm_required) {
			const ok = await dialogs.confirm({
				title: 'Use this model?',
				body: r.confirm_message || 'This model may be expensive.',
				action: 'Use model',
			})
			if (!ok) return false
			r = await dashboard.setModel(provider, model, { profile, confirm: true })
		}
		if (!r.ok) throw new Error('Hermes did not take the model.')
		return true
	}

	/**
	 * A bot's model: its default for everything it runs, and its Bot Chat locked to it as well, since Hermes keeps a
	 * chat on the model it started with. A change of reasoning alone only touches the Bot Chat. False when the user
	 * declined.
	 */
	async function setBotModel(bot: Bot, chatId: string | undefined, choice: ChatModel) {
		const bots = useBots()
		if (choice.provider !== bot.provider || choice.model !== bot.model) {
			if (!(await setDefault(choice.provider, choice.model, bot.isDefault ? undefined : bot.name))) return false
			await bots.load()
		}
		if (chatId) await apply(chatId, choice)
		return true
	}

	// Chosen on another device: the relay says so, and coming back to the app reads them all again.
	onRpcEvent('caduceus.chatModels', (p) => {
		const { id, choice } = (p ?? {}) as { id?: string; choice?: ChatModel | null }
		if (!id) return
		if (choice) choices.value = { ...choices.value, [id]: choice }
		else if (id in choices.value) {
			const { [id]: _, ...rest } = choices.value
			choices.value = rest
		}
	})
	onResync(() => {
		if (loading) loading = load().catch(() => {})
	})

	return { choices, supported, ensure, apply, setDefault, setBotModel }
})
