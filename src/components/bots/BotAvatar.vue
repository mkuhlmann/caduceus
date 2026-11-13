<script setup lang="ts">
import { computed } from 'vue'
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

const label = computed(() => {
	const who = props.alt ?? props.seed
	return props.state === 'idle' ? who : `${who}: ${STATE_LABELS[props.state]}`
})
</script>

<template>
	<span
		class="bot-avatar relative inline-block shrink-0"
		:class="[`is-${state}`, { still, lively }]"
		:style="style"
		role="img"
		:aria-label="label"
		:title="hint ?? label"
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
					<g v-else class="gaze">
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
@keyframes turn {
	to {
		transform: rotate(360deg);
	}
}
</style>
