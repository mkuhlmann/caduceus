/** Split a SKILL.md into its YAML frontmatter fields and the markdown body. */
export function parseSkill(src: string) {
	const m = src.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
	const meta: Record<string, string> = {}
	if (!m) return { meta, body: src }
	let key = ''
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
		if (kv) {
			key = kv[1]
			meta[key] = kv[2].replace(/^(["'])(.*)\1$/, '$2')
		} else if (key && /^\s+\S/.test(line) && meta[key] !== undefined && !/^\s*-/.test(line)) {
			meta[key] = (meta[key] + ' ' + line.trim()).trim()
		}
	}
	if (/^[>|][-+]?$/.test(meta.description ?? '')) meta.description = ''
	return { meta, body: src.slice(m[0].length) }
}

export function skillTemplate(name = 'my-skill') {
	return `---\nname: ${name}\ndescription: One sentence on what this skill does and when Hermes should use it.\n---\n\n# ${name}\n\n## When to use\n\nDescribe the situations where this skill applies.\n\n## Steps\n\n1. First step\n2. Second step\n`
}

export const provenanceLabel = (p: string) =>
	({ bundled: 'Built in', hub: 'From the hub', agent: 'Written by Hermes', external: 'External' })[p] ?? p
