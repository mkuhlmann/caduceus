import { ApiError } from '@/lib/http'
import { useBots, type Bot } from '@/stores/bots'
import { useToasts } from '@/stores/toast'
import { useDialogs } from '@/stores/dialogs'

/**
 * Let Caduceus talk to a bot made elsewhere (the Hermes desktop app, the terminal). A bot with a gateway key keeps it
 * and Caduceus shares it; one without gets a new key. Only when Caduceus cannot read the bot's key does it offer to
 * replace it, which locks out the apps that use the old one, so that asks first.
 */
export async function connectBot(bot: Bot) {
	const bots = useBots()
	const toasts = useToasts()
	try {
		try {
			await bots.connect(bot.name)
		} catch (e) {
			if (!(e instanceof ApiError && e.code === 'key_exists')) throw e
			const ok = await useDialogs().confirm({
				title: `Replace the gateway key of ${bot.displayName}?`,
				body: `${bot.displayName} already has a gateway key, but Hermes would not show it to Caduceus. Apps using the old key, such as Hermes Desktop or another Caduceus, need to reconnect it afterwards.`,
				action: 'Replace key',
				danger: true,
			})
			if (!ok) return false
			await bots.connect(bot.name, true)
		}
		toasts.push('Bot connected')
		return true
	} catch (e) {
		toasts.error(`Could not connect the bot. ${(e as Error).message}`)
		return false
	}
}

/**
 * The bot's gateway rejected the key Caduceus keeps, and the relay could not pick up the bot's current one (it
 * adopts a key another app set on its own). Offer to give the bot a fresh key. False when declined; throws when it
 * fails.
 */
export async function reconnectBot(bot: Bot) {
	const ok = await useDialogs().confirm({
		title: `Give ${bot.displayName} a new key?`,
		body: `${bot.displayName} no longer accepts the key Caduceus keeps for it, and Hermes would not show Caduceus its current one. Apps using the current key, such as Hermes Desktop or another Caduceus, then need to reconnect it.`,
		action: 'Give new key',
		danger: true,
	})
	if (!ok) return false
	await useBots().connect(bot.name, true)
	useToasts().push('Bot reconnected')
	return true
}
