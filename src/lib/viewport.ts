/**
 * Keeps the app inside the part of the screen the reader can see while a phone's keyboard is up.
 *
 * Without this a phone browser lays the page out at full height and slides it up under the keyboard to show
 * the focused field: the header leaves the screen and the whole page scrolls. Chrome on Android shrinks the
 * page itself when the viewport meta asks for `interactive-widget=resizes-content`; Safari on iOS ignores
 * that, so the app takes the visual viewport's height (`--app-height`) and undoes the browser's scroll.
 * While the keyboard is up `<html data-keyboard>` is set, and the phone's bottom bar gives way to the chat.
 */
export function fitToVisibleViewport() {
	const vv = window.visualViewport
	if (!vv) return
	const root = document.documentElement
	// The tallest the viewport has been at this width: the screen without a keyboard. A rotation starts over.
	let width = 0
	let full = 0
	const touch = matchMedia('(pointer: coarse)')

	function apply() {
		// Pinch zoom also shrinks the visual viewport; the layout stays as it is then.
		if (vv!.scale > 1.01) return
		if (vv!.width !== width) {
			width = vv!.width
			full = 0
		}
		full = Math.max(full, vv!.height, window.innerHeight)
		root.style.setProperty('--app-height', `${Math.round(vv!.height)}px`)
		// A keyboard takes far more than the browser's own bars do when they slide in and out.
		root.toggleAttribute('data-keyboard', touch.matches && full - vv!.height > 120)
		if (window.scrollY || vv!.offsetTop) window.scrollTo(0, 0)
	}

	vv.addEventListener('resize', apply)
	vv.addEventListener('scroll', apply)
	apply()
}
