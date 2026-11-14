/** In-memory drafts per chat, so switching chats doesn't carry over typed text or images. */
export const drafts = new Map<string, { text: string; images: string[] }>()

/** Whether a reload now would lose something the user typed: a saved draft or text in any open text box. */
export function hasUnsentWork() {
	if (drafts.size) return true
	return [...document.querySelectorAll('textarea')].some((t) => t.value.trim() !== '')
}
