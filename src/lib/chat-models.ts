/**
 * Chat models: the model (and reasoning level) a chat runs on, which Caduceus locks onto the chat in Hermes
 * (`POST /api/sessions/{id}/model`). Hermes gives a client back only the chat's model name, never its provider or
 * reasoning level, so the relay keeps what was chosen (`server/chat-models.ts`, in `state.json`). The server and the
 * browser share this module.
 */
import { Type, type Static } from '@sinclair/typebox'

/** Reasoning levels offered; none set means the model's own default. */
export const REASONING = ['off', 'low', 'medium', 'high'] as const
export type Reasoning = (typeof REASONING)[number]

export const ChatModelSchema = Type.Object(
	{
		provider: Type.String({ maxLength: 80 }),
		model: Type.String({ minLength: 1, maxLength: 200 }),
		reasoning: Type.Optional(Type.Union(REASONING.map((r) => Type.Literal(r)))),
	},
	{ additionalProperties: false },
)
export type ChatModel = Static<typeof ChatModelSchema>

/** Every chat's choice, by session id. */
export const ChatModelsSchema = Type.Record(Type.String(), ChatModelSchema, { default: {} })
export type ChatModels = Static<typeof ChatModelsSchema>

/** A model as one string, as favorites and the bot settings select keep it. */
export const modelKey = (m: { provider: string; model: string }) => `${m.provider}::${m.model}`

export function parseModelKey(key: string): { provider: string; model: string } | undefined {
	const i = key.indexOf('::')
	if (i < 0) return undefined
	const model = key.slice(i + 2)
	return model ? { provider: key.slice(0, i), model } : undefined
}

/** What a model can do with reasoning, as Hermes' model options report it per model. */
export type ModelCaps = { reasoning?: boolean; can_disable_reasoning?: boolean; fast?: boolean }
export type ProviderModels = {
	slug: string
	name: string
	models: string[]
	capabilities?: Record<string, ModelCaps>
}

/** `model_options` for Hermes: a level, reasoning off, or nothing for the model's default. */
export function modelOptionsFor(reasoning?: Reasoning): Record<string, unknown> {
	if (!reasoning) return {}
	if (reasoning === 'off') return { reasoning: { enabled: false } }
	return { reasoning: { enabled: true, effort: reasoning } }
}

/**
 * The provider a model name most likely runs on: `prefer` when it lists the model (several providers may list
 * the same name), else the first that does, else `prefer` anyway.
 */
export function providerOf(providers: ProviderModels[], model: string, prefer = ''): string {
	if (providers.some((p) => p.slug === prefer && p.models.includes(model))) return prefer
	return providers.find((p) => p.models.includes(model))?.slug ?? prefer
}

/**
 * The levels a model offers, or none when it does not reason. A model Hermes knows nothing about offers them all;
 * one that cannot turn reasoning off offers no "off".
 */
export function reasoningLevels(providers: ProviderModels[], m: { provider: string; model: string }): Reasoning[] {
	const caps = providers.find((p) => p.slug === m.provider)?.capabilities?.[m.model]
	if (caps?.reasoning === false) return []
	return caps?.can_disable_reasoning === false ? REASONING.filter((r) => r !== 'off') : [...REASONING]
}

/** A level the model can take, or none when it cannot take this one. */
export function keepReasoning(
	providers: ProviderModels[],
	m: { provider: string; model: string },
	reasoning?: Reasoning,
): Reasoning | undefined {
	return reasoning && reasoningLevels(providers, m).includes(reasoning) ? reasoning : undefined
}

/**
 * What the chat's model menu lists: the favorites in the order starred, with the model in use first when it is not
 * one of them, so the menu always shows what is running.
 */
export function shortList(
	favorites: string[],
	current?: { provider: string; model: string },
): { provider: string; model: string; favorite: boolean }[] {
	const favs = favorites.map(parseModelKey).filter((m) => !!m)
	const list = favs.map((m) => ({ ...m, favorite: true }))
	if (current?.model && !favorites.includes(modelKey(current)))
		list.unshift({ provider: current.provider, model: current.model, favorite: false })
	return list
}

/**
 * The model a chat runs on: what was chosen here while Hermes still reports that model, else the model Hermes has
 * stored on the chat, else `fallback` (the default for chats that have not run yet).
 */
export function currentModel(opts: {
	chosen?: ChatModel
	stored?: string | null
	fallback?: { provider: string; model: string }
	providers: ProviderModels[]
}): ChatModel | undefined {
	const { chosen, stored, fallback, providers } = opts
	if (chosen && (!stored || stored === chosen.model)) return chosen
	if (stored) return { provider: providerOf(providers, stored, fallback?.provider), model: stored }
	return fallback?.model ? { provider: fallback.provider, model: fallback.model } : undefined
}

/** A model's name as the menu shows it: without the vendor path OpenRouter puts in front. */
export const shortName = (model: string) => model.slice(model.lastIndexOf('/') + 1)

export const REASONING_LABELS: Record<Reasoning, string> = {
	off: 'Off',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
}
