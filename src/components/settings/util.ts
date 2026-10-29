export const CATEGORY_NAMES: Record<string, string> = {
	general: 'General',
	agent: 'Agent',
	terminal: 'Terminal',
	display: 'Display',
	delegation: 'Delegation',
	memory: 'Memory',
	compression: 'Context compression',
	security: 'Security',
	browser: 'Browser',
	voice: 'Voice',
	tts: 'Text to speech',
	stt: 'Speech to text',
	logging: 'Logging',
	discord: 'Discord',
	auxiliary: 'Auxiliary models',
}

export const sentence = (s: string) => {
	const t = s.replace(/[_-]+/g, ' ').trim().toLowerCase()
	return t.charAt(0).toUpperCase() + t.slice(1)
}
export const categoryName = (c: string) => CATEGORY_NAMES[c] ?? sentence(c)

export function getIn(obj: any, key: string): any {
	return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
}

export function setIn(obj: Record<string, any>, key: string, value: unknown) {
	const parts = key.split('.')
	let o = obj
	for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}
	o[parts[parts.length - 1]] = value
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Label from the last path segment; help text unless it merely repeats the key ("Agent → Disabled Toolsets"). */
export function describeField(key: string, description?: string) {
	const parts = key.split('.')
	const label = sentence(parts[parts.length - 1])
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
	const d = description?.trim() ?? ''
	const auto = d.includes('→') || norm(d) === norm(label) || norm(d) === norm(parts.join(' '))
	return { label, help: auto ? '' : d }
}

/** Subheading from the path between the category prefix and the last segment. */
export function groupOf(key: string, category: string) {
	const parts = key.split('.')
	parts.pop()
	if (parts[0] === category || parts[0] === 'model') parts.shift()
	return parts.length ? sentence(parts.join(' ')) : ''
}
