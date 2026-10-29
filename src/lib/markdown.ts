import { Marked } from 'marked'
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

export function renderMarkdown(src: string): string {
	const html = marked.parse(src ?? '', { async: false }) as string
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-copy'] })
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
