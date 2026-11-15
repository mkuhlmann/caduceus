import { expect, test } from 'bun:test'
import { botDisplayName } from '@/lib/bot-name'

test('a bot goes by its title, then its display name, then a readable profile name, as in the app', () => {
	expect(botDisplayName('research-bot', 'Ada', 'Researcher')).toBe('Ada')
	expect(botDisplayName('research-bot', '  ', 'Researcher')).toBe('Researcher')
	expect(botDisplayName('research-bot', undefined, undefined)).toBe('Research Bot')
	// Hermes' own profile is called "default"; nobody should read that in a notification.
	expect(botDisplayName('default', undefined, undefined)).toBe('Hermes')
})
