import { onBeforeUnmount, ref } from 'vue'

/** Why recording could not start, worded for a toast. */
export class VoiceError extends Error {}

/** Browsers offer the microphone only on HTTPS and localhost; over plain HTTP the API is missing altogether. */
export function voiceSupported() {
	return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

// Opus in WebM where the browser has it (Chrome, Firefox), MP4 in Safari. Hermes converts whatever it gets.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function startError(e: unknown) {
	const name = (e as DOMException)?.name
	if (name === 'NotAllowedError' || name === 'SecurityError')
		return new VoiceError("Caduceus can't use your microphone. Allow it in your browser's site settings.")
	if (name === 'NotFoundError' || name === 'OverconstrainedError')
		return new VoiceError('No microphone found. Connect one and try again.')
	if (name === 'NotReadableError') return new VoiceError('Another app is using the microphone. Close it and try again.')
	return new VoiceError(`Could not start recording. ${(e as Error)?.message ?? e}`)
}

/**
 * Records from the microphone. `onLevel` gets the input level (0–1) every frame, for a meter that moves with your
 * voice; it is a callback rather than state so the meter can be driven without re-rendering the composer.
 */
export function useRecorder(onLevel?: (level: number) => void) {
	const state = ref<'idle' | 'starting' | 'recording' | 'stopping'>('idle')
	/** Seconds since recording began. */
	const elapsed = ref(0)

	let stream: MediaStream | null = null
	let recorder: MediaRecorder | null = null
	let chunks: Blob[] = []
	let audio: AudioContext | null = null
	let frame = 0
	let timer = 0
	// Bumped by every release, so a start still waiting on the permission prompt knows it was called off.
	let run = 0

	async function start() {
		if (state.value !== 'idle') return
		if (!voiceSupported()) throw new VoiceError('Voice input needs Caduceus to be opened over HTTPS or on localhost.')
		state.value = 'starting'
		const mine = ++run
		let s: MediaStream
		try {
			s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
		} catch (e) {
			if (mine === run) state.value = 'idle'
			throw startError(e)
		}
		if (mine !== run) return s.getTracks().forEach((t) => t.stop())
		stream = s
		const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
		recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined)
		chunks = []
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
		recorder.start()
		meter(s)
		const began = performance.now()
		elapsed.value = 0
		timer = window.setInterval(() => (elapsed.value = (performance.now() - began) / 1000), 250)
		state.value = 'recording'
	}

	function meter(s: MediaStream) {
		if (!onLevel) return
		try {
			audio = new AudioContext()
			const analyser = audio.createAnalyser()
			analyser.fftSize = 512
			audio.createMediaStreamSource(s).connect(analyser)
			const samples = new Uint8Array(analyser.fftSize)
			let smooth = 0
			const tick = () => {
				analyser.getByteTimeDomainData(samples)
				let sum = 0
				for (const v of samples) sum += ((v - 128) / 128) ** 2
				// Speech sits around 0.02–0.2 RMS; stretch that to fill the meter, rise fast and fall slowly.
				const level = Math.min(1, Math.sqrt(sum / samples.length) * 5)
				smooth = level > smooth ? level : smooth * 0.85 + level * 0.15
				onLevel(smooth)
				frame = requestAnimationFrame(tick)
			}
			tick()
		} catch {
			// The meter is a nicety; recording works without it.
		}
	}

	/** Ends the recording and hands back the audio. */
	function stop(): Promise<Blob | null> {
		const r = recorder
		if (state.value === 'stopping') return Promise.resolve(null)
		if (!r || r.state === 'inactive') return Promise.resolve(release())
		state.value = 'stopping'
		return new Promise((resolve) => {
			r.onstop = () => {
				const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
				release()
				resolve(blob.size ? blob : null)
			}
			r.stop()
		})
	}

	/** Throws the recording away. */
	function cancel() {
		if (recorder) {
			recorder.onstop = null
			if (recorder.state !== 'inactive') recorder.stop()
		}
		release()
	}

	// Lets go of the microphone so the browser's recording indicator goes away.
	function release() {
		run++
		stream?.getTracks().forEach((t) => t.stop())
		audio?.close().catch(() => {})
		cancelAnimationFrame(frame)
		clearInterval(timer)
		stream = recorder = audio = null
		chunks = []
		state.value = 'idle'
		elapsed.value = 0
		onLevel?.(0)
		return null
	}

	onBeforeUnmount(cancel)

	return { state, elapsed, start, stop, cancel }
}

/** A recording as a data URL, the form Hermes' transcription endpoint takes. */
export function toDataUrl(blob: Blob) {
	return new Promise<string>((resolve, reject) => {
		const r = new FileReader()
		r.onload = () => resolve(r.result as string)
		r.onerror = () => reject(r.error)
		r.readAsDataURL(blob)
	})
}
