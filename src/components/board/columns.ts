export const COLUMNS: Record<string, { label: string; hint: string }> = {
	triage: { label: 'Triage', hint: 'Rough ideas waiting for Hermes to write a proper spec.' },
	todo: { label: 'To do', hint: 'Specified, but waiting on other tasks or a decision.' },
	scheduled: { label: 'Scheduled', hint: 'Waiting for a set time before it can start.' },
	ready: { label: 'Ready', hint: 'Ready to be picked up by an agent.' },
	running: { label: 'Running', hint: 'An agent is working on this right now.' },
	blocked: { label: 'Blocked', hint: 'Stuck until someone answers or unblocks it.' },
	review: { label: 'Review', hint: 'Finished work waiting for a reviewer.' },
	done: { label: 'Done', hint: 'Completed.' },
}

/** Mirrors kanban_workflow.DEFAULT_WORKFLOW.manual: which statuses a person may move a task into. */
export const MANUAL: Record<string, string[]> = {
	triage: ['todo', 'ready'],
	todo: ['triage', 'scheduled', 'ready'],
	scheduled: ['triage', 'todo', 'ready'],
	ready: ['triage', 'todo', 'scheduled', 'blocked', 'review', 'done'],
	running: ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done'],
	blocked: ['triage', 'todo', 'scheduled', 'ready', 'done'],
	review: ['triage', 'todo', 'ready', 'done'],
	done: ['triage', 'todo', 'ready'],
}
/** Columns that are not offered as targets (they need extra input or are kernel-only). */
export const LOCKED = new Set(['scheduled', 'running', 'review'])

export const label = (k: string) => COLUMNS[k]?.label ?? k
export function targets(from: string): string[] {
	return (MANUAL[from] ?? []).filter((s) => !LOCKED.has(s))
}
export const canDrop = (from: string, to: string) => targets(from).includes(to)
