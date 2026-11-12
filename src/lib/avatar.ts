/**
 * Bot faces: one solid body drawn from a formula, with two capsule eyes cut out of it. The body and the eyes
 * carry the bot's state through motion (see BotAvatar.vue), so there is no separate status badge.
 */

export type BotLook = { shape: string; color: string; eyes?: string }

export type BotState = 'idle' | 'thinking' | 'working' | 'waiting' | 'blocked' | 'done'

/** Bodies are drawn in a 100×100 box centred on 0,0; the extras (thought dots, sparkle) stay inside it too. */
export const VIEWBOX = '-50 -50 100 100'

type Point = readonly [number, number]

const TAU = Math.PI * 2
const STEPS = 120

/** A closed curve sampled at evenly spaced angles. */
const trace = (at: (t: number) => Point): Point[] => Array.from({ length: STEPS }, (_, i) => at((i / STEPS) * TAU))

/** A circle whose radius ripples: each term is [ripples per turn, depth, phase]. */
const ripple = (...terms: [number, number, number][]) =>
	trace((t) => {
		const r = terms.reduce((acc, [k, depth, phase]) => acc + depth * Math.cos(k * t + phase), 1)
		return [r * Math.cos(t), r * Math.sin(t)]
	})

/** |x|^n + |y|^n = 1: a square that has had its corners worn round. */
const superellipse = (n: number) =>
	trace((t) => {
		const c = Math.cos(t)
		const s = Math.sin(t)
		return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)]
	})

/** The usual parametric heart, flipped so it points down. */
const heart = () =>
	trace((t) => [
		16 * Math.sin(t) ** 3,
		-(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
	])

/** A teardrop with its point at the top. */
const drop = () => trace((t) => [Math.sin(t) * Math.abs(Math.sin(t / 2)) ** 1.15, -Math.cos(t)])

/** Centres a curve and scales it so its longer side is `size`; `sy` squashes it after that. */
function fit(points: Point[], size: number, sy = 1): Point[] {
	const xs = points.map((p) => p[0])
	const ys = points.map((p) => p[1])
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
	const k = size / Math.max(x1 - x0, y1 - y0)
	return points.map(([x, y]) => [(x - (x0 + x1) / 2) * k, (y - (y0 + y1) / 2) * k * sy])
}

const UP = -Math.PI / 2

type Body = { label: string; outline: () => Point[]; /** Where the eyes sit, down from the centre. */ eyeY: number }

const BODIES: Record<string, Body> = {
	pebble: { label: 'Pebble', outline: () => fit(ripple([2, 0.07, 0]), 86, 0.94), eyeY: -2 },
	egg: { label: 'Egg', outline: () => fit(ripple([1, 0.09, UP], [2, -0.05, 0]), 84), eyeY: 2 },
	cushion: { label: 'Cushion', outline: () => fit(superellipse(5), 80, 0.93), eyeY: -2 },
	clover: { label: 'Clover', outline: () => fit(ripple([3, 0.12, UP]), 88), eyeY: -1 },
	petal: { label: 'Petal', outline: () => fit(ripple([5, 0.075, UP]), 88), eyeY: -2 },
	star: { label: 'Soft star', outline: () => fit(ripple([5, 0.16, UP], [10, 0.02, 0]), 90), eyeY: 1 },
	heart: { label: 'Heart', outline: () => fit(heart(), 86), eyeY: -2 },
	drop: { label: 'Drop', outline: () => fit(drop(), 90), eyeY: 10 },
}

/** Body names from earlier versions, so a saved look keeps a face close to the one it had. */
const OLD_NAMES: Record<string, string> = {
	cloud: 'pebble',
	blob: 'pebble',
	squircle: 'cushion',
	flower: 'petal',
	bloom: 'star',
	bell: 'egg',
	mushroom: 'clover',
}

const bodyName = (shape: string | undefined) => {
	const name = shape ? (OLD_NAMES[shape] ?? shape) : undefined
	return name && BODIES[name] ? name : undefined
}

export const SHAPES = Object.keys(BODIES)
/** Faces a bot gets without choosing: the heart is kept for those who pick it. */
const GENERATED_SHAPES = SHAPES.filter((s) => s !== 'heart')

export const SHAPE_LABELS: Record<string, string> = Object.fromEntries(SHAPES.map((s) => [s, BODIES[s]!.label]))

/** Bright, saturated bodies that read at sidebar size. No amber: that would read as live activity. */
export const COLORS: Record<string, string> = {
	violet: '#9D7BFF',
	blue: '#3D8BFF',
	cyan: '#20B8A6',
	green: '#2EBD6B',
	orange: '#FF7A3D',
	red: '#F2475A',
	pink: '#F062B0',
	brown: '#9E7A58',
	slate: '#8E9AAF',
	white: '#F4F4F2',
}

export const COLOR_LABELS: Record<string, string> = {
	violet: 'Violet',
	blue: 'Blue',
	cyan: 'Cyan',
	green: 'Green',
	orange: 'Orange',
	red: 'Red',
	pink: 'Pink',
	brown: 'Brown',
	slate: 'Slate',
	white: 'White',
}

export function seedOf(identity: string) {
	let h = 0
	for (let i = 0; i < identity.length; i++) {
		h = (h << 5) - h + identity.charCodeAt(i)
		h |= 0
	}
	return Math.abs(h)
}

const outlines = new Map<string, Point[]>()
const round = (v: number) => Math.round(v * 100) / 100

/**
 * The body as an SVG path. The seed stretches it a few percent one way or the other, so two bots with the same
 * body still differ a little.
 */
export function bodyPath(shape: string, seed: number): string {
	const name = bodyName(shape) ?? 'pebble'
	let outline = outlines.get(name)
	if (!outline) outlines.set(name, (outline = BODIES[name]!.outline()))
	const stretch = ((seed % 7) - 3) / 100
	return `M${outline.map(([x, y]) => `${round(x * (1 + stretch))} ${round(y * (1 - stretch))}`).join('L')}Z`
}

/** The two capsule eyes: their size, how far apart they sit (from the seed) and how far down (from the body). */
export function eyesOf(shape: string, seed: number) {
	const w = 8
	const h = 17
	const gap = 12 + (seed % 3)
	const y = BODIES[bodyName(shape) ?? 'pebble']!.eyeY
	return { w, h, gap, y }
}

/** Eyes are cut-outs in the page colour, unless the body is so light they would vanish. */
export function eyesAreDark(hex: string) {
	return contrast(hex, '#FFFFFF') < 2.4
}

/**
 * A bot's colour made deep enough to carry white text (WCAG AA, 4.5:1): the fill for your own messages in its
 * chat. Light bodies like white or slate turn into their grey.
 */
export function messageFill(hex: string) {
	const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	let out = hex
	for (let f = 1; f > 0 && contrast(out, '#FFFFFF') < 4.5; f -= 0.01)
		out = `#${rgb
			.map((c) =>
				Math.round(c * f)
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')}`
	return out
}

function contrast(a: string, b: string) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi! + 0.05) / (lo! + 0.05)
}

function luminance(hex: string) {
	const n = hex.replace('#', '')
	const full =
		n.length === 3
			? n
					.split('')
					.map((c) => c + c)
					.join('')
			: n
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(full.slice(i, i + 2), 16) / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** sRGB hex to OKLab, where straight-line distance tracks how different two colours look. */
function oklab(hex: string): [number, number, number] {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	}) as [number, number, number]
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	]
}

/** The body colour that looks closest to any colour, e.g. the one Hermes drew a bot's face in. */
export function nearestColor(hex: string): string {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'violet'
	const [l, a, b] = oklab(hex)
	let best = 'violet'
	let bestDistance = Infinity
	for (const [name, value] of Object.entries(COLORS)) {
		const [l2, a2, b2] = oklab(value)
		// One shade per hue here, so hue and colourfulness count for more than lightness.
		const d = 0.3 * (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2
		if (d < bestDistance) [best, bestDistance] = [name, d]
	}
	return best
}

/** The face a name gets when nobody chose one. */
export function generatedLook(name: string): BotLook {
	const s = seedOf(name)
	// Generated faces get a lively colour; slate and white are there for those who choose them.
	const colors = Object.keys(COLORS).filter((c) => c !== 'white' && c !== 'slate')
	return { shape: GENERATED_SHAPES[s % GENERATED_SHAPES.length]!, color: colors[(s >>> 4) % colors.length]! }
}

/**
 * A saved look with unknown parts (a hand-edited file) falls back to the generated ones; bodies from earlier
 * versions get their closest new body.
 */
export function resolveLook(name: string, look?: Partial<BotLook> | null): BotLook {
	const g = generatedLook(name)
	return {
		shape: bodyName(look?.shape) ?? g.shape,
		color: look?.color && COLORS[look.color] ? look.color : g.color,
	}
}

export function randomLook(): BotLook {
	return generatedLook(Math.random().toString(36))
}

export const STATE_LABELS: Record<BotState, string> = {
	idle: 'Idle',
	thinking: 'Thinking',
	working: 'Working',
	waiting: 'Waiting for you',
	blocked: 'Stuck',
	done: 'Done',
}

/** Downscale a picked image to a small square so it travels and stores cheaply. */
export async function squareImage(file: File, size = 192): Promise<string> {
	const bitmap = await createImageBitmap(file)
	const side = Math.min(bitmap.width, bitmap.height)
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d')!
	ctx.imageSmoothingQuality = 'high'
	ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
	bitmap.close()
	const webp = canvas.toDataURL('image/webp', 0.86)
	return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}
