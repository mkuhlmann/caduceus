import type { TSchema } from '@sinclair/typebox'

/**
 * A schema without its defaults, for a change sent by a device. A field missing from a change means "leave it as it
 * is"; with the stored schema's defaults, the server would fill it in and reset it.
 */
export function withoutDefaults<T extends TSchema>(schema: T): T {
	const copy = (v: any): any => {
		if (!v || typeof v !== 'object') return v
		if (Array.isArray(v)) return v.map(copy)
		const out: any = {}
		// Reflect.ownKeys keeps TypeBox's symbol keys (its Kind), which a JSON copy would lose.
		for (const key of Reflect.ownKeys(v)) if (key !== 'default') out[key] = copy(v[key])
		return out
	}
	return copy(schema)
}
