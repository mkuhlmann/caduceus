import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
	ChatModelSchema,
	currentModel,
	keepReasoning,
	modelKey,
	modelOptionsFor,
	parseModelKey,
	providerOf,
	reasoningLevels,
	shortList,
	shortName,
	type ProviderModels,
} from '@/lib/chat-models'

const providers: ProviderModels[] = [
	{
		slug: 'nous',
		name: 'Nous Portal',
		models: ['anthropic/claude-opus-5.5', 'hermes-4'],
		capabilities: { 'anthropic/claude-opus-5.5': { reasoning: true, can_disable_reasoning: false } },
	},
	{
		slug: 'openrouter',
		name: 'OpenRouter',
		models: ['anthropic/claude-opus-5.5', 'qwen/qwen3.8-flash'],
		capabilities: { 'qwen/qwen3.8-flash': { reasoning: false } },
	},
]

test('a model key round-trips, and the model may hold colons and slashes', () => {
	expect(parseModelKey(modelKey({ provider: 'nous', model: 'a/b:free' }))).toEqual({
		provider: 'nous',
		model: 'a/b:free',
	})
	expect(parseModelKey('no-separator')).toBeUndefined()
	expect(parseModelKey('nous::')).toBeUndefined()
})

test('reasoning goes to Hermes as model options, and the default sends none', () => {
	expect(modelOptionsFor()).toEqual({})
	expect(modelOptionsFor('off')).toEqual({ reasoning: { enabled: false } })
	expect(modelOptionsFor('high')).toEqual({ reasoning: { enabled: true, effort: 'high' } })
})

test('a model name listed by several providers takes the preferred one, else the first', () => {
	expect(providerOf(providers, 'anthropic/claude-opus-5.5', 'openrouter')).toBe('openrouter')
	expect(providerOf(providers, 'anthropic/claude-opus-5.5', 'zai')).toBe('nous')
	expect(providerOf(providers, 'unknown', 'zai')).toBe('zai')
})

test('levels follow what the model can do', () => {
	expect(reasoningLevels(providers, { provider: 'openrouter', model: 'qwen/qwen3.8-flash' })).toEqual([])
	expect(reasoningLevels(providers, { provider: 'nous', model: 'anthropic/claude-opus-5.5' })).toEqual([
		'low',
		'medium',
		'high',
	])
	// Nothing known: every level.
	expect(reasoningLevels(providers, { provider: 'nous', model: 'hermes-4' })).toEqual(['off', 'low', 'medium', 'high'])
})

test('a level carries over to another model only when that model takes it', () => {
	const opus = { provider: 'nous', model: 'anthropic/claude-opus-5.5' }
	expect(keepReasoning(providers, opus, 'high')).toBe('high')
	expect(keepReasoning(providers, opus, 'off')).toBeUndefined()
	expect(keepReasoning(providers, { provider: 'openrouter', model: 'qwen/qwen3.8-flash' }, 'low')).toBeUndefined()
	expect(keepReasoning(providers, opus)).toBeUndefined()
})

test('the menu lists favorites in starred order, with the model in use first when it is not one', () => {
	const favs = ['nous::hermes-4', 'openrouter::qwen/qwen3.8-flash', 'broken']
	expect(shortList(favs, { provider: 'nous', model: 'hermes-4' })).toEqual([
		{ provider: 'nous', model: 'hermes-4', favorite: true },
		{ provider: 'openrouter', model: 'qwen/qwen3.8-flash', favorite: true },
	])
	expect(shortList(favs, { provider: 'zai', model: 'glm-5' })[0]).toEqual({
		provider: 'zai',
		model: 'glm-5',
		favorite: false,
	})
	expect(shortList([], undefined)).toEqual([])
})

test("a chat's model: the choice made here, unless Hermes now reports another model", () => {
	const chosen = { provider: 'openrouter', model: 'anthropic/claude-opus-5.5', reasoning: 'high' as const }
	const fallback = { provider: 'zai', model: 'glm-5' }
	expect(currentModel({ chosen, stored: 'anthropic/claude-opus-5.5', fallback, providers })).toEqual(chosen)
	// Switched elsewhere (a /model in the terminal): Hermes' model wins, its provider guessed.
	expect(currentModel({ chosen, stored: 'hermes-4', fallback, providers })).toEqual({
		provider: 'nous',
		model: 'hermes-4',
	})
	// A chat that has not run yet starts on the default.
	expect(currentModel({ stored: null, fallback, providers })).toEqual(fallback)
	expect(currentModel({ providers })).toBeUndefined()
})

test('the record the relay keeps is checked', () => {
	expect(Value.Check(ChatModelSchema, { provider: 'nous', model: 'hermes-4', reasoning: 'low' })).toBe(true)
	expect(Value.Check(ChatModelSchema, { provider: 'nous', model: 'hermes-4', reasoning: 'extreme' })).toBe(false)
	expect(Value.Check(ChatModelSchema, { provider: 'nous', model: '' })).toBe(false)
})

test('a short name drops the vendor path', () => {
	expect(shortName('anthropic/claude-opus-5.5')).toBe('claude-opus-5.5')
	expect(shortName('glm-5')).toBe('glm-5')
})
