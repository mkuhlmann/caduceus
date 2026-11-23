import { Elysia } from 'elysia'
import { Type } from '@sinclair/typebox'
import { broadcast } from './hermes-socket'
import { saveState, state } from './store'
import { ChatModelSchema } from '../src/lib/chat-models'

/**
 * The model chosen for each chat (`src/lib/chat-models.ts`), kept in `state.json`. The browser locks the model onto
 * the chat in Hermes, then records it here: Hermes tells clients a chat's model name, but not its provider or
 * reasoning level.
 */
const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 200 }) })

export const chatModelRoutes = new Elysia({ prefix: '/ui-api/chat-models' })
	.get('/', () => state.chatModels)
	.put(
		'/:id',
		({ params, body }) => {
			state.chatModels[params.id] = body
			saveState()
			// Other devices show the new choice at once.
			broadcast('caduceus.chatModels', { id: params.id, choice: body })
			return body
		},
		{ params, body: ChatModelSchema },
	)

/** A gateway path was deleted: when it was a chat (`[p/<bot>/]api/sessions/<id>`), forget its choice. */
export function chatDeleted(path: string) {
	const m = /^(?:p\/[^/]+\/)?api\/sessions\/([^/]+)$/.exec(path)
	const id = m && decodeURIComponent(m[1]!)
	if (!id || !(id in state.chatModels)) return
	delete state.chatModels[id]
	saveState()
	broadcast('caduceus.chatModels', { id, choice: null })
}
