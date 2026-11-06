import { Marked, type Token } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		code({ text, lang }) {
			const language = lang && hljs.getLanguage(lang) ? lang : undefined
			const html = language ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text)
			const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''
			return `<div class="code-block">${label}<button type="button" class="code-copy" data-copy>Copy</button><pre><code class="hljs">${html}</code></pre></div>`
		},
	},
})

export function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function sanitize(html: string) {
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy'] })
}

/** Small LRU: parsing, highlighting and sanitizing is the expensive part of showing a reply. */
class Lru<V> {
	private map = new Map<string, V>()
	constructor(private max: number) {}
	get(k: string) {
		const v = this.map.get(k)
		if (v !== undefined) {
			this.map.delete(k)
			this.map.set(k, v)
		}
		return v
	}
	set(k: string, v: V) {
		this.map.delete(k)
		this.map.set(k, v)
		if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
	}
}

const blockCache = new Lru<string>(2000)
const docCache = new Lru<string[]>(300)

/**
 * Markdown as a list of sanitized HTML blocks, one per top-level element. A finished block is rendered
 * once and reused (`streaming` skips caching the whole, ever-changing text), so a streaming reply only re-renders its growing last block, and the DOM can be
 * patched block by block instead of being rebuilt on every token.
 */
export function markdownBlocks(src: string, { streaming = false } = {}): string[] {
	src = src ?? ''
	const hit = streaming ? undefined : docCache.get(src)
	if (hit) return hit
	const tokens = marked.lexer(src)
	let out: string[]
	// Raw HTML can open in one block and close in another; sanitize those as a whole.
	if (tokens.some((t) => t.type === 'html')) out = [sanitize(marked.parser(tokens))]
	else {
		const content = tokens.filter((t) => t.type !== 'space' && t.type !== 'def')
		out = content.map((t: Token, i) => {
			const last = i === content.length - 1
			const cached = last ? undefined : blockCache.get(t.raw)
			if (cached !== undefined) return cached
			const html = sanitize(marked.parser([t]))
			if (!last) blockCache.set(t.raw, html)
			return html
		})
	}
	// Every streamed prefix is new and seen once: keep it out of the cache.
	if (!streaming) docCache.set(src, out)
	return out
}

export function renderMarkdown(src: string): string {
	return markdownBlocks(src).join('')
}

/** Delegated click handler for the copy buttons rendered into code blocks. */
export function handleCodeCopy(e: MouseEvent) {
	const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null
	if (!btn) return
	const code = btn.parentElement?.querySelector('code')?.textContent ?? ''
	navigator.clipboard?.writeText(code)
	btn.textContent = 'Copied'
	setTimeout(() => (btn.textContent = 'Copy'), 1400)
}
