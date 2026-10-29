import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const server = process.env.CADUCEUS_SERVER ?? 'http://127.0.0.1:7811'

export default defineConfig({
	plugins: [vue(), tailwindcss()],
	base: './',
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	server: {
		host: '0.0.0.0',
		port: 5173,
		proxy: { '/ui-api': { target: server, changeOrigin: true, ws: true } },
	},
	build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
