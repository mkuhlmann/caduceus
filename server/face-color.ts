import { inflateSync } from 'node:zlib'

/**
 * What a face Hermes drew for a bot looks like: its main colour and, when it is clearly one of a few plain outlines,
 * the nearest of Caduceus's bodies. Reads 8-bit RGB or RGBA PNGs without interlacing, which is what Hermes draws
 * faces as; anything else (a photo, another format) gives null.
 */
export function readFace(png: Buffer): { color: string | null; shape: string | null } | null {
	const pixels = decode(png)
	if (!pixels) return null
	return { color: mainColor(pixels), shape: pixels.channels === 4 ? outline(pixels) : null }
}

type Pixels = { rgba: Uint8Array; channels: number; width: number; height: number }

/** The most common colour among the opaque pixels, so the body wins over the eyes and the edges. */
function mainColor({ rgba, channels }: Pixels): string | null {
	// Colours are counted in buckets of 16 levels per channel, so antialiased edges fall in with the body.
	const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
	for (let i = 0; i < rgba.length; i += channels) {
		if (channels === 4 && rgba[i + 3]! < 200) continue
		const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
		const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
		s.n++
		s.r += r
		s.g += g
		s.b += b
		buckets.set(key, s)
	}
	let top: { n: number; r: number; g: number; b: number } | undefined
	for (const s of buckets.values()) if (!top || s.n > top.n) top = s
	if (!top) return null
	const hex = (v: number) =>
		Math.round(v / top.n)
			.toString(16)
			.padStart(2, '0')
	return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`
}

/**
 * The body a silhouette is closest to, judged from how much of its box it fills and how its width changes from top
 * to bottom: a square, a triangle, or something round. Anything less plain (a heart, a star, a drop) gives null, and
 * the bot keeps the body its name gives it.
 */
function outline({ rgba, width, height }: Pixels): string | null {
	const rows: number[] = []
	let [top, bottom, left, right, area] = [height, -1, width, -1, 0]
	for (let y = 0; y < height; y++) {
		let n = 0
		for (let x = 0; x < width; x++) {
			if (rgba[(y * width + x) * 4 + 3]! < 128) continue
			n++
			left = Math.min(left, x)
			right = Math.max(right, x)
		}
		rows.push(n)
		area += n
		if (n) [top, bottom] = [Math.min(top, y), y]
	}
	const [w, h] = [right - left + 1, bottom - top + 1]
	if (area < 64 || w < 8 || h < 8) return null
	const fill = area / (w * h)
	// Mean width of a band of rows, as a share of the box: 0 is the top edge, 1 the bottom.
	const band = (from: number, to: number) => {
		const ys = rows.slice(top + Math.floor(from * h), top + Math.ceil(to * h))
		return ys.reduce((a, n) => a + n, 0) / Math.max(1, ys.length) / w
	}
	const [upper, middle, lower] = [band(0.1, 0.3), band(0.4, 0.6), band(0.7, 0.9)]
	const aspect = w / h
	if (fill > 0.86 && upper > 0.85 && lower > 0.85 && aspect > 0.8 && aspect < 1.25) return 'cushion'
	// Narrow at the top and widest at the bottom, with straight-ish sides: the middle sits halfway between.
	if (upper < 0.5 * lower && lower > 0.75 && fill > 0.4 && fill < 0.7 && Math.abs(middle - (upper + lower) / 2) < 0.12)
		return 'clover'
	// An ellipse fills about 79% of its box, and its top and bottom bands are equally wide.
	if (fill > 0.72 && fill < 0.84 && Math.abs(upper - lower) < 0.12 && middle > 0.9)
		return aspect >= 1 ? 'pebble' : 'egg'
	return null
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function decode(png: Buffer): Pixels | null {
	if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) return null
	let width = 0
	let height = 0
	let channels = 0
	const data: Buffer[] = []
	for (let at = 8; at + 8 <= png.length;) {
		const length = png.readUInt32BE(at)
		const type = png.toString('latin1', at + 4, at + 8)
		const body = png.subarray(at + 8, at + 8 + length)
		if (type === 'IHDR') {
			width = body.readUInt32BE(0)
			height = body.readUInt32BE(4)
			const [depth, colorType, , , interlace] = [body[8], body[9], body[10], body[11], body[12]]
			channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
			if (depth !== 8 || !channels || interlace !== 0 || width * height > 1024 * 1024) return null
		} else if (type === 'IDAT') data.push(body)
		else if (type === 'IEND') break
		at += 12 + length
	}
	if (!channels || !data.length) return null
	let raw: Buffer
	try {
		raw = inflateSync(Buffer.concat(data))
	} catch {
		return null
	}
	const stride = width * channels
	if (raw.length < height * (stride + 1)) return null
	const out = new Uint8Array(height * stride)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
		const row = y * stride
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? out[row + x - channels]! : 0
			const up = y > 0 ? out[row - stride + x]! : 0
			const upLeft = y > 0 && x >= channels ? out[row - stride + x - channels]! : 0
			let v = line[x]!
			if (filter === 1) v += left
			else if (filter === 2) v += up
			else if (filter === 3) v += (left + up) >> 1
			else if (filter === 4) {
				const p = left + up - upLeft
				const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
				v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
			}
			out[row + x] = v & 0xff
		}
	}
	return { rgba: out, channels, width, height }
}
