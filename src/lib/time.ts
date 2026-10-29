const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function toDate(v: number | string | null | undefined): Date | null {
	if (v == null || v === '') return null
	if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
	const d = new Date(v)
	return isNaN(d.getTime()) ? null : d
}

export function relative(v: number | string | null | undefined): string {
	const d = toDate(v)
	if (!d) return ''
	const diff = (d.getTime() - Date.now()) / 1000
	const abs = Math.abs(diff)
	if (abs < 45) return diff < 0 ? 'just now' : 'in a moment'
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
	if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day')
	return d.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
	})
}

export function dateTime(v: number | string | null | undefined): string {
	const d = toDate(v)
	return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

/** Group label for a sidebar list: Today, Yesterday, Previous 7 days, Month Year. */
export function dayGroup(v: number | string | null | undefined): string {
	const d = toDate(v)
	if (!d) return 'Earlier'
	const start = new Date()
	start.setHours(0, 0, 0, 0)
	const days = Math.floor((start.getTime() - d.getTime()) / 86400000) + 1
	if (d >= start) return 'Today'
	if (days <= 1) return 'Yesterday'
	if (days <= 7) return 'Previous 7 days'
	return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
