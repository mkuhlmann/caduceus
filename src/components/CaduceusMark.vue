<script setup lang="ts">
import { useId } from 'vue'

// The mask cuts a gap in one strand where the other passes over it; ids must be unique per instance.
const weave = `caduceus-weave-${useId()}`
</script>

<template>
	<!--
		Caduceus: the staff (currentColor) carries two strands that weave around it and open into wings.
		The strands and wings are the agent's gold; the staff takes the surrounding ink.
	-->
	<svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
		<mask :id="weave" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
			<rect width="32" height="32" fill="#fff" />
			<path
				d="M18.86 17.55C18.12 18.1 17.04 18.65 16 19.2C14.96 19.75 13.99 20.3 13.39 20.85"
				stroke="#000"
				stroke-width="3.2"
			/>
		</mask>
		<g stroke-linecap="round" stroke-width="1.8">
			<path d="M16 5.8V13.2M16 25.2V27" stroke="currentColor" />
			<path
				d="M16 13.2C13.8 14.2 12 15.2 12.1 16.2C12.2 17.2 14.12 18.2 16 19.2C17.88 20.2 19.4 21.2 19.3 22.2C19.2 23.2 17.57 24.2 16 25.2"
				stroke="var(--gold)"
				:mask="`url(#${weave})`"
			/>
			<path
				d="M16 13.2C18.2 14.2 20 15.2 19.9 16.2C19.8 17.2 17.88 18.2 16 19.2C14.12 20.2 12.6 21.2 12.7 22.2C12.8 23.2 14.43 24.2 16 25.2"
				stroke="var(--gold)"
			/>
		</g>
		<circle cx="16" cy="5.8" r="1.8" fill="currentColor" />
		<path d="M15.63 14.02C11.53 12.16 6.4 8.14 3.4 6.4C7.6 2.8 12.6 6.8 16.37 12.38Z" fill="var(--gold)" />
		<path d="M16.37 14.02C20.47 12.16 25.6 8.14 28.6 6.4C24.4 2.8 19.4 6.8 15.63 12.38Z" fill="var(--gold)" />
	</svg>
</template>
