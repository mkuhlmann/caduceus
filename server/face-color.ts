import { inflateSync } from 'node:zlib'

/**
 * The main colour of a drawn face: the most common colour among its opaque pixels, so the body wins over the eyes
 * and the edges. Reads 8-bit RGB or RGBA PNGs without interlacing, which is what Hermes draws faces as; anything
 * else (a photo, another format) gives null.
 */
export function faceColor(png: Buffer): string | null {
	const pixels = decode(png)
	if (!pixels) return null
	const { rgba, channels } = pixels
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

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function decode(png: Buffer): { rgba: Uint8Array; channels: number } | null {
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
	return { rgba: out, channels }
}
