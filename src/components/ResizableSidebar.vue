<script lang="ts">
import { ref, watch } from 'vue'

const KEY = 'caduceus.sidebarWidth'
const MIN = 220
const MAX = 520
const DEFAULT = 288

function clamp(w: number) {
	return Math.min(MAX, Math.max(MIN, Math.round(w)))
}

// One width for every left sidebar, kept on this device only, like the theme.
const width = ref(clamp(Number(localStorage.getItem(KEY)) || DEFAULT))
watch(width, (w) => localStorage.setItem(KEY, String(w)))
</script>

<script setup lang="ts">
/** The desktop column for a left sidebar, with a handle on its right edge to drag it wider or narrower. */
const dragging = ref(false)

function start(e: PointerEvent) {
	if (e.button !== 0) return
	e.preventDefault()
	const handle = e.currentTarget as HTMLElement
	handle.setPointerCapture(e.pointerId)
	const x0 = e.clientX
	const w0 = width.value
	dragging.value = true
	const move = (ev: PointerEvent) => (width.value = clamp(w0 + ev.clientX - x0))
	const end = () => {
		dragging.value = false
		handle.removeEventListener('pointermove', move)
		handle.removeEventListener('pointerup', end)
		handle.removeEventListener('pointercancel', end)
	}
	handle.addEventListener('pointermove', move)
	handle.addEventListener('pointerup', end)
	handle.addEventListener('pointercancel', end)
}

function key(e: KeyboardEvent) {
	const step = e.shiftKey ? 48 : 16
	if (e.key === 'ArrowLeft') width.value = clamp(width.value - step)
	else if (e.key === 'ArrowRight') width.value = clamp(width.value + step)
	else if (e.key === 'Home') width.value = MIN
	else if (e.key === 'End') width.value = MAX
	else return
	e.preventDefault()
}
</script>

<template>
	<div class="relative hidden shrink-0 md:block" :style="{ width: `${width}px` }">
		<slot />
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			:aria-valuenow="width"
			:aria-valuemin="MIN"
			:aria-valuemax="MAX"
			tabindex="0"
			title="Drag to resize, double-click to reset"
			class="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none select-none"
			@pointerdown="start"
			@dblclick="width = DEFAULT"
			@keydown="key"
		>
			<span
				class="h-full w-0.5 bg-focus opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
				:class="{ 'opacity-100': dragging }"
			/>
		</div>
	</div>
	<Teleport v-if="dragging" to="body">
		<div class="fixed inset-0 z-50 cursor-col-resize" />
	</Teleport>
</template>
