import { ApiError } from '@/lib/http'
import { useBots, type Bot } from '@/stores/bots'
import { useToasts } from '@/stores/toast'

/**
 * Let Caduceus talk to a bot made elsewhere (the Hermes desktop app, the terminal). Caduceus gives it a gateway
 * key of its own; when the bot already has one, other apps may rely on it, so replacing it asks first.
 */
export async function connectBot(bot: Bot) {
	const bots = useBots()
	const toasts = useToasts()
	try {
		try {
			await bots.connect(bot.name)
		} catch (e) {
			if (!(e instanceof ApiError && e.code === 'key_exists')) throw e
			const ok = confirm(
				`${bot.displayName} already has a gateway key. Replace it with one Caduceus keeps? Apps using the old key, such as a peer Hermes, need the new one afterwards.`,
			)
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
