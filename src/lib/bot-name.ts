/** A profile name as a person would write it: `research-bot` reads "Research Bot". */
export function prettyName(name: string) {
	return name
		.replace(/[-_]+/g, ' ')
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The name a bot goes by, in the order Hermes Desktop uses, so a bot reads the same everywhere: the title given to it,
 * then its profile's display name, then "Hermes" for Hermes itself, else its profile name made readable.
 */
export function botDisplayName(name: string, title: string | undefined, displayName: string | undefined) {
	const isDefault = name === 'default'
	return title?.trim() || displayName?.trim() || (isDefault ? 'Hermes' : prettyName(name))
}
