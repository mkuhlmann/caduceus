import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const server = process.env.CADUCEUS_SERVER ?? 'http://127.0.0.1:7811'

/** Writes dist/sw.js from src/sw.js, with every built file as its precache list and a content hash as its version. */
function pwa(): Plugin {
	let outDir = ''
	return {
		name: 'caduceus-pwa',
		apply: 'build',
		configResolved: (config) => void (outDir = resolve(config.root, config.build.outDir)),
		closeBundle() {
			const files = (readdirSync(outDir, { recursive: true }) as string[])
				.map((f) => f.replaceAll('\\', '/'))
				.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && statSync(join(outDir, f)).isFile())
				.sort()
			const hash = createHash('sha256')
			for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)))
			const source = readFileSync(fileURLToPath(new URL('./src/sw.js', import.meta.url)), 'utf8')
			writeFileSync(
				join(outDir, 'sw.js'),
				source
					.replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
					.replace('__PRECACHE__', JSON.stringify(files)),
			)
		},
	}
}

export default defineConfig({
	plugins: [vue(), tailwindcss(), pwa()],
	base: './',
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	server: {
		host: '0.0.0.0',
		port: 5173,
		proxy: { '/ui-api': { target: server, changeOrigin: true, ws: true } },
	},
	build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
