<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import {
	COLORS,
	STATE_LABELS,
	VIEWBOX,
	bodyPath,
	eyesAreDark,
	eyesOf,
	resolveLook,
	seedOf,
	type BotLook,
	type BotState,
} from '@/lib/avatar'

/**
 * A bot's face: a solid body with two capsule eyes. The face carries the bot's state, so there is no separate
 * badge. Idle it blinks now and then; thinking it tilts, looks up and thought dots rise; working it glows, wobbles
 * like jelly and its narrowed eyes read side to side; waiting for an approval it hops with wide eyes and looks up
 * as dots rise into an exclamation mark; asking it leans and looks up at a question mark that sways above it; stuck
 * it slumps, greys and sweats; done it bounces once with happy eyes and a sparkle. The current action is in the
 * hover text.
 *
 * A `pettable` face that is idle answers a click with one of a few pleased moves, picked at random: a wiggle, a
 * squish with a floating heart, a jump, or a giggle with sparkles.
 */
const props = withDefaults(
	defineProps<{
		/** The profile name: it seeds the generated face, its proportions and its rhythm. */
		seed: string
		look?: Partial<BotLook> | null
		image?: string | null
		state?: BotState
		size?: number
		/** Accessible name, usually the bot's display name. */
		alt?: string
		/** Hover text; defaults to the state. */
		hint?: string
		/** No motion and no extras: pickers, and the faces beside older replies. */
		still?: boolean
		/** Idle, a click plays a pleased animation. */
		pettable?: boolean
	}>(),
	{ state: 'idle', size: 32 },
)

const look = computed(() => resolveLook(props.seed, props.look))
const n = computed(() => seedOf(props.seed))
const color = computed(() => COLORS[look.value.color]!)
const path = computed(() => bodyPath(look.value.shape, n.value))
const eyes = computed(() => eyesOf(look.value.shape, n.value))
const eyeFill = computed(() => (eyesAreDark(color.value) ? '#1d1f2b' : 'var(--bg)'))
const lively = computed(() => !props.still && (props.state === 'working' || props.state === 'thinking'))
const extras = computed(() => !props.still && props.size >= 24)

/** Left and right eye centres. */
const eyeX = computed(() => [-eyes.value.gap, eyes.value.gap])

const style = computed(() => ({
	width: `${props.size}px`,
	height: `${props.size}px`,
	'--tint': color.value,
	'--halo': `${Math.max(2, Math.round(props.size * 0.12))}px`,
	// Every bot runs on its own clock, so a roster never blinks together.
	'--blink-gap': `${5 + (n.value % 4)}s`,
	'--offset': `-${(n.value % 900) / 100}s`,
}))

/** Each move and how long it runs, in ms. */
const MOVES = { wiggle: 900, heart: 1100, boing: 900, giggle: 1000 } as const
type Move = keyof typeof MOVES

const root = ref<HTMLElement>()
const move = ref<Move | null>(null)
const petReady = computed(() => !!props.pettable && !props.still && props.state === 'idle')
let last: Move | null = null
let timer: ReturnType<typeof setTimeout> | undefined

async function pet() {
	if (!petReady.value) return
	const options = (Object.keys(MOVES) as Move[]).filter((m) => m !== last)
	const next = options[Math.floor(Math.random() * options.length)]!
	last = next
	clearTimeout(timer)
	// Clear the class and let a layout pass happen, so a click during a move starts the next one cleanly.
	move.value = null
	await nextTick()
	void root.value?.offsetWidth
	move.value = next
	timer = setTimeout(() => (move.value = null), MOVES[next])
}
onBeforeUnmount(() => clearTimeout(timer))

const label = computed(() => {
	const who = props.alt ?? props.seed
	return props.state === 'idle' ? who : `${who}: ${STATE_LABELS[props.state]}`
})
</script>

<template>
	<span
		ref="root"
		class="bot-avatar relative inline-block shrink-0"
		:class="[`is-${state}`, move && ['petted', `pet-${move}`], { still, lively, pettable: petReady }]"
		:style="style"
		:role="petReady ? 'button' : 'img'"
		:tabindex="petReady ? 0 : undefined"
		:aria-label="label"
		:title="hint ?? label"
		@click="pet"
		@keydown.enter.space.prevent="pet"
	>
		<template v-if="image">
			<span class="photo absolute inset-0 overflow-hidden rounded-full">
				<img :src="image" alt="" class="size-full object-cover" />
			</span>
			<svg v-if="lively" class="orbit absolute -inset-[12%]" viewBox="0 0 100 100" fill="none" aria-hidden="true">
				<path d="M50 4 A46 46 0 0 1 96 50" :stroke="color" stroke-width="6" stroke-linecap="round" />
			</svg>
		</template>
		<svg v-else :viewBox="VIEWBOX" class="face size-full overflow-visible" aria-hidden="true">
			<g class="whole">
				<path class="body" :d="path" :fill="color" />
				<g v-if="petReady && extras" class="blush" fill="#ffb3c0">
					<ellipse v-for="x in eyeX" :key="x" :cx="x * 1.8" :cy="eyes.y + 14" rx="7" ry="4" />
				</g>
				<g :transform="`translate(0 ${eyes.y})`">
					<template v-if="state === 'done'">
						<g fill="none" :stroke="eyeFill" stroke-width="4.4" stroke-linecap="round">
							<path v-for="x in eyeX" :key="x" :d="`M${x - 6} 3Q${x} -7 ${x + 6} 3`" />
						</g>
					</template>
					<template v-else-if="state === 'blocked'">
						<g fill="none" :stroke="eyeFill" stroke-width="4.4" stroke-linecap="round">
							<path :d="`M${eyeX[0]! - 6} 0L${eyeX[0]! + 6} 4`" />
							<path :d="`M${eyeX[1]! - 6} 4L${eyeX[1]! + 6} 0`" />
						</g>
					</template>
					<template v-else>
						<g class="gaze">
							<g class="lid" :fill="eyeFill">
								<rect
									v-for="x in eyeX"
									:key="x"
									:x="x - eyes.w / 2"
									:y="-eyes.h / 2"
									:width="eyes.w"
									:height="eyes.h"
									:rx="eyes.w / 2"
								/>
							</g>
						</g>
						<g v-if="petReady" class="pleased" fill="none" :stroke="eyeFill" stroke-width="4.4" stroke-linecap="round">
							<path v-for="x in eyeX" :key="x" :d="`M${x - 6} 3Q${x} -7 ${x + 6} 3`" />
						</g>
					</template>
				</g>
				<path
					v-if="extras && state === 'blocked'"
					class="sweat"
					fill="#8fd3ff"
					d="M-30 -34Q-25.5 -27 -30 -25Q-34.5 -27 -30 -34Z"
				/>
			</g>
			<g v-if="extras && state === 'thinking'" class="dots" :fill="color">
				<circle cx="26" cy="-34" r="2.6" />
				<circle cx="33" cy="-41" r="3.4" />
				<circle cx="41" cy="-49" r="4.2" />
			</g>
			<template v-if="petReady && extras">
				<path
					class="love"
					fill="#ff8fa3"
					d="M30 -30C22 -36 19 -42 24 -45C27 -47 30 -44 30 -42C30 -44 33 -47 36 -45C41 -42 38 -36 30 -30Z"
				/>
				<g class="glints" fill="#fff">
					<path d="M-38 -38Q-38 -32 -32 -32Q-38 -32 -38 -26Q-38 -32 -44 -32Q-38 -32 -38 -38Z" />
					<path d="M38 -42Q38 -35 45 -35Q38 -35 38 -28Q38 -35 31 -35Q38 -35 38 -42Z" />
					<path d="M44 8Q44 13 49 13Q44 13 44 18Q44 13 39 13Q44 13 44 8Z" />
					<path d="M-44 6Q-44 11 -39 11Q-44 11 -44 16Q-44 11 -49 11Q-44 11 -44 6Z" />
				</g>
			</template>
			<path
				v-if="extras && state === 'done'"
				class="sparkle"
				fill="#fff"
				d="M36 -45Q36 -36 45 -36Q36 -36 36 -27Q36 -36 27 -36Q36 -36 36 -45Z"
			/>
		</svg>
		<svg
			v-if="extras && (state === 'asking' || state === 'waiting')"
			:viewBox="VIEWBOX"
			class="pointer-events-none absolute inset-0 size-full overflow-visible"
			aria-hidden="true"
		>
			<g
				v-if="state === 'waiting'"
				class="alert"
				:fill="color"
				stroke="var(--bg)"
				stroke-width="3"
				paint-order="stroke"
			>
				<circle cx="26" cy="-34" r="2.6" />
				<circle cx="32" cy="-41" r="3.4" />
				<text x="42" y="-38" font-size="38" font-weight="900" text-anchor="middle">!</text>
			</g>
			<text
				v-else
				class="ask"
				x="36"
				y="-24"
				font-size="54"
				font-weight="900"
				text-anchor="middle"
				:fill="color"
				stroke="var(--bg)"
				stroke-width="5"
				paint-order="stroke"
			>
				?
			</text>
		</svg>
	</span>
</template>

<style scoped>
.face {
	filter: drop-shadow(0 1px 1.2px rgb(0 0 0 / 0.25));
	transition: filter var(--dur) var(--ease-out);
}
.lively .face {
	filter: drop-shadow(0 0 var(--halo) var(--tint));
}
.face * {
	transform-box: fill-box;
	transform-origin: center;
}
.whole {
	transform-origin: 50% 100%;
}
.gaze,
.lid {
	transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.photo {
	box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
}
.orbit {
	width: 124%;
	height: 124%;
	animation: turn 1.1s linear infinite;
}

/* Idle: a blink now and then. */
.is-idle .lid {
	animation: blink var(--blink-gap) ease-in-out var(--offset) infinite;
}

/* Thinking: tilts back and forth, eyes up and wandering, thought dots rising. */
.is-thinking .whole {
	animation: tilt 3.6s ease-in-out infinite;
}
.is-thinking .gaze {
	animation: ponder 3.6s ease-in-out infinite;
}
.is-thinking .photo {
	animation: breathe 2.8s ease-in-out infinite;
}
.dots circle {
	opacity: 0;
	animation: rise 1.8s ease-in-out infinite;
}
.dots circle:nth-child(2) {
	animation-delay: 0.3s;
}
.dots circle:nth-child(3) {
	animation-delay: 0.6s;
}

/* Working: wobbles like jelly, eyes narrowed and reading side to side. */
.is-working .body {
	animation: jelly 1s ease-in-out infinite;
}
.is-working .lid {
	transform: scaleY(0.62);
}
.is-working .gaze {
	animation: read 1.9s ease-in-out infinite;
}
.is-working .photo {
	animation: breathe 1.6s ease-in-out infinite;
}

/* Waiting for you: wide eyes and a hop now and then. */
.is-waiting .lid {
	transform: scale(1.2);
}
.is-waiting .whole,
.is-waiting .photo {
	animation: hop 1.7s ease-out infinite;
}
.is-waiting .gaze {
	transform: translate(3px, -4px);
}
/* Two dots rise, then the exclamation mark pops in after them. */
.alert > * {
	transform-box: fill-box;
	transform-origin: center;
	opacity: 0;
}
.alert circle {
	animation: rise-hold 2.4s ease-in-out infinite;
}
.alert circle:nth-child(2) {
	animation-delay: 0.25s;
}
.alert text {
	animation: pop-in 2.4s var(--ease-out) 0.5s infinite;
}

/* Asking you something: leans and looks up, one eye a little narrower, at a question mark that sways above. */
.is-asking .whole {
	transform: rotate(-8deg);
}
.is-asking .gaze {
	transform: translate(4px, -6px);
}
.is-asking .lid {
	transform: scale(1.15);
}
.is-asking .lid rect:first-child {
	transform: scale(0.8);
}
.is-asking .photo {
	animation: breathe 2.6s ease-in-out infinite;
}
.ask {
	transform-box: fill-box;
	transform-origin: 50% 100%;
	animation: sway 2.6s ease-in-out infinite;
}

/* Stuck: slumps to one side, loses its colour, sweats. */
.is-blocked .whole {
	transform: rotate(-9deg) translateY(3px);
}
.is-blocked .body {
	filter: saturate(0.35) brightness(0.88);
}
.is-blocked .photo {
	filter: grayscale(0.6);
}
.sweat {
	animation: drip 2.2s ease-in infinite;
}

/* Done: one bounce, happy eyes, a sparkle. */
.is-done .whole,
.is-done .photo {
	animation: bounce 0.8s ease-out 1;
}
.sparkle {
	animation: twinkle 2.4s ease-in-out infinite;
}

/* Petted: happy eyes and a blush for the length of the move, plus the move itself. */
.pettable {
	cursor: pointer;
	border-radius: 999px;
}
.blush,
.pleased,
.love,
.glints path {
	opacity: 0;
}
.pet-wiggle {
	--pet: 900ms;
}
.pet-heart {
	--pet: 1100ms;
}
.pet-boing {
	--pet: 900ms;
}
.pet-giggle {
	--pet: 1000ms;
}
.petted .gaze {
	animation: eyes-off var(--pet) linear;
}
.petted .pleased,
.petted .blush {
	animation: eyes-on var(--pet) linear;
}
.pet-wiggle .whole,
.pet-wiggle .photo {
	animation: wiggle var(--pet) ease-in-out;
}
.pet-heart .whole,
.pet-heart .photo {
	animation: squish 600ms var(--ease-out);
}
.pet-heart .love {
	animation: float var(--pet) ease-out;
}
.pet-boing .whole,
.pet-boing .photo {
	animation: boing var(--pet) cubic-bezier(0.3, 0.7, 0.4, 1);
}
.pet-giggle .whole,
.pet-giggle .photo {
	animation: giggle 700ms linear;
}
.pet-giggle .glints path {
	animation: burst 800ms var(--ease-out) both;
}
.pet-giggle .glints path:nth-child(2) {
	animation-delay: 80ms;
}
.pet-giggle .glints path:nth-child(3) {
	animation-delay: 160ms;
}
.pet-giggle .glints path:nth-child(4) {
	animation-delay: 240ms;
}

.still *,
.still .face {
	animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
	.bot-avatar * {
		animation: none !important;
	}
}

@keyframes blink {
	0%,
	93%,
	100% {
		transform: scaleY(1);
	}
	95% {
		transform: scaleY(0.08);
	}
	97% {
		transform: scaleY(1);
	}
}
@keyframes breathe {
	0%,
	100% {
		transform: scale(1);
	}
	50% {
		transform: scale(1.04);
	}
}
@keyframes tilt {
	0%,
	100% {
		transform: rotate(-5deg);
	}
	50% {
		transform: rotate(5deg);
	}
}
@keyframes ponder {
	0%,
	100% {
		transform: translate(-4px, -5px);
	}
	40%,
	60% {
		transform: translate(4px, -6px);
	}
}
@keyframes jelly {
	0%,
	100% {
		transform: scale(1);
	}
	22% {
		transform: scale(1.07, 0.93);
	}
	48% {
		transform: scale(0.95, 1.05);
	}
	74% {
		transform: scale(1.02, 0.98);
	}
}
@keyframes read {
	0%,
	100% {
		transform: translateX(-4px);
	}
	50% {
		transform: translateX(4px);
	}
}
@keyframes hop {
	0%,
	58%,
	100% {
		transform: translateY(0) scale(1);
	}
	10% {
		transform: translateY(0) scale(1.07, 0.91);
	}
	26% {
		transform: translateY(-11%) scale(0.95, 1.06);
	}
	42% {
		transform: translateY(0) scale(1.05, 0.95);
	}
	50% {
		transform: translateY(0) scale(1);
	}
}
@keyframes bounce {
	0% {
		transform: scale(1);
	}
	35% {
		transform: scale(1.09);
	}
	70% {
		transform: scale(0.97);
	}
	100% {
		transform: scale(1);
	}
}
@keyframes rise {
	0% {
		opacity: 0;
		transform: translateY(4px);
	}
	30%,
	70% {
		opacity: 1;
		transform: none;
	}
	100% {
		opacity: 0;
		transform: translateY(-2px);
	}
}
@keyframes rise-hold {
	0% {
		opacity: 0;
		transform: translateY(4px);
	}
	20%,
	80% {
		opacity: 1;
		transform: none;
	}
	100% {
		opacity: 0;
	}
}
@keyframes pop-in {
	0% {
		opacity: 0;
		transform: scale(0.4) rotate(-20deg);
	}
	15%,
	80% {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
	100% {
		opacity: 0;
		transform: scale(0.9);
	}
}
@keyframes sway {
	0%,
	100% {
		transform: rotate(-10deg) translateY(0);
	}
	50% {
		transform: rotate(10deg) translateY(-3px);
	}
}
@keyframes drip {
	0% {
		opacity: 0;
		transform: translateY(-3px);
	}
	25%,
	65% {
		opacity: 1;
	}
	100% {
		opacity: 0;
		transform: translateY(7px);
	}
}
@keyframes twinkle {
	0%,
	100% {
		opacity: 0;
		transform: scale(0.3) rotate(0deg);
	}
	35%,
	65% {
		opacity: 1;
		transform: scale(1) rotate(45deg);
	}
}
@keyframes eyes-off {
	0% {
		opacity: 1;
	}
	8%,
	82% {
		opacity: 0;
	}
	92%,
	100% {
		opacity: 1;
	}
}
@keyframes eyes-on {
	0% {
		opacity: 0;
	}
	8%,
	82% {
		opacity: 1;
	}
	92%,
	100% {
		opacity: 0;
	}
}
@keyframes wiggle {
	0%,
	100% {
		transform: none;
	}
	15% {
		transform: rotate(-10deg);
	}
	35% {
		transform: rotate(9deg);
	}
	55% {
		transform: rotate(-6deg);
	}
	75% {
		transform: rotate(3deg);
	}
}
@keyframes squish {
	0%,
	100% {
		transform: none;
	}
	25% {
		transform: scale(1.1, 0.88);
	}
	55% {
		transform: scale(0.95, 1.07);
	}
	80% {
		transform: scale(1.02, 0.98);
	}
}
@keyframes float {
	0% {
		opacity: 0;
		transform: translate(-6px, 8px) scale(0.3);
	}
	20% {
		opacity: 1;
		transform: translate(0, 0) scale(1.1);
	}
	70% {
		opacity: 1;
		transform: translate(3px, -12px) scale(1) rotate(8deg);
	}
	100% {
		opacity: 0;
		transform: translate(4px, -20px) scale(0.9) rotate(12deg);
	}
}
@keyframes boing {
	0%,
	100% {
		transform: none;
	}
	15% {
		transform: scale(1.16, 0.82);
	}
	40% {
		transform: translateY(-34%) scale(0.9, 1.12);
	}
	62% {
		transform: translateY(0) scale(1.14, 0.86);
	}
	78% {
		transform: scale(0.97, 1.04);
	}
	90% {
		transform: scale(1.01, 0.99);
	}
}
@keyframes giggle {
	0%,
	100% {
		transform: none;
	}
	10% {
		transform: translate(-3%, -2%) rotate(-3deg);
	}
	20% {
		transform: translate(3%, 0) rotate(3deg);
	}
	30% {
		transform: translate(-3%, -3%) rotate(-3deg);
	}
	40% {
		transform: translate(3%, 0) rotate(2deg);
	}
	50% {
		transform: translate(-2%, -2%) rotate(-2deg);
	}
	60% {
		transform: translate(2%, 0) rotate(2deg);
	}
	75% {
		transform: translate(-1%, -1%);
	}
}
@keyframes burst {
	0% {
		opacity: 0;
		transform: scale(0.2) translate(0, 6px);
	}
	30% {
		opacity: 1;
		transform: scale(1.1);
	}
	100% {
		opacity: 0;
		transform: scale(0.5) translate(0, -6px) rotate(60deg);
	}
}
@keyframes turn {
	to {
		transform: rotate(360deg);
	}
}
</style>
