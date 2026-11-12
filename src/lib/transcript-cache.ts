import type { Message } from './gateway'

/**
 * The newest part of each transcript saved in IndexedDB, so a chat opened after a reload paints at once from
 * its last known state while a fresh copy loads. localStorage is too small for tool output and images.
 *
 * Only the most recently opened chats are kept, within a total size. Everything belongs to one gateway:
 * connecting to another one drops the lot, so its chats never show up here.
 */

const DB = 'caduceus'
const STORE = 'transcripts'
const META = 'meta'
const KEEP = 60
const BUDGET = 30 * 1024 * 1024
// A transcript bigger than this is saved without its inline images; one still bigger is not saved at all.
const SLIM_OVER = 2 * 1024 * 1024
const SKIP_OVER = 6 * 1024 * 1024

// `more`: the chat has messages older than the saved ones, still on the server.
type Row = { id: string; json: string; partial: boolean; more?: boolean }
type Index = { scope: string; items: Record<string, { usedAt: number; bytes: number }> }
export type Saved = { messages: Message[]; partial: boolean; more: boolean }

let db: Promise<IDBDatabase | null> | undefined
function open() {
	db ??= new Promise((resolve) => {
		try {
			const req = indexedDB.open(DB, 1)
			req.onupgradeneeded = () => {
				req.result.createObjectStore(STORE, { keyPath: 'id' })
				req.result.createObjectStore(META)
			}
			req.onsuccess = () => resolve(req.result)
			// Private mode or blocked storage: chats just load from the network.
			req.onerror = () => resolve(null)
			req.onblocked = () => resolve(null)
		} catch {
			resolve(null)
		}
	})
	return db
}

function done<T>(req: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

// The gateway these transcripts came from. Reads wait for it, so a switched connection never paints stale chats.
let setScopeReady: () => void
const scopeReady = new Promise<void>((r) => (setScopeReady = r))
let index: Promise<Index> | undefined

async function readIndex(d: IDBDatabase): Promise<Index> {
	const v = await done(d.transaction(META).objectStore(META).get('index')).catch(() => null)
	return v && typeof v === 'object' && v.items ? (v as Index) : { scope: '', items: {} }
}

function writeIndex(d: IDBDatabase, ix: Index) {
	d.transaction(META, 'readwrite').objectStore(META).put(ix, 'index')
}

/** Tell the cache which gateway is connected; a different one than last time drops every saved transcript. */
export function setTranscriptScope(scope: string) {
	index = (async () => {
		const d = await open()
		const ix = d ? await readIndex(d) : { scope, items: {} }
		if (d && ix.scope !== scope) {
			await done(d.transaction(STORE, 'readwrite').objectStore(STORE).clear()).catch(() => {})
			const fresh = { scope, items: {} }
			writeIndex(d, fresh)
			return fresh
		}
		return ix
	})()
	setScopeReady()
}

async function ready() {
	// Before the app knows its connection, nothing is read: a miss only means the network answers instead.
	const known = await Promise.race([scopeReady.then(() => true), new Promise((r) => setTimeout(r, 3000, false))])
	if (!known || !index) return null
	const d = await open()
	return d ? { d, ix: await index } : null
}

export async function readTranscript(id: string): Promise<Saved | null> {
	const r = await ready()
	if (!r || !r.ix.items[id]) return null
	try {
		const row = (await done(r.d.transaction(STORE).objectStore(STORE).get(id))) as Row | undefined
		if (!row) return null
		r.ix.items[id]!.usedAt = Date.now()
		writeIndex(r.d, r.ix)
		return { messages: JSON.parse(row.json), partial: row.partial, more: !!row.more }
	} catch {
		return null
	}
}

/** Inline images (pasted screenshots) are most of a big transcript's size; the network copy still has them. */
function withoutImages(ms: Message[]): Message[] {
	return ms.map((m) =>
		Array.isArray(m.content)
			? {
					...m,
					content: m.content.filter((p) => {
						const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url
						return !url?.startsWith('data:')
					}),
				}
			: m,
	)
}

async function write(id: string, { ms, more }: Queued) {
	const r = await ready()
	if (!r) return
	let json = JSON.stringify(ms)
	let partial = false
	if (json.length > SLIM_OVER) {
		json = JSON.stringify(withoutImages(ms))
		partial = true
	}
	const tx = r.d.transaction(STORE, 'readwrite')
	const store = tx.objectStore(STORE)
	if (json.length > SKIP_OVER) {
		store.delete(id)
		delete r.ix.items[id]
	} else {
		store.put({ id, json, partial, more } satisfies Row)
		r.ix.items[id] = { usedAt: Date.now(), bytes: json.length }
	}
	// Least recently opened go first, until both the count and the size fit.
	const byUse = Object.entries(r.ix.items).sort((a, b) => b[1].usedAt - a[1].usedAt)
	let total = 0
	byUse.forEach(([key, v], i) => {
		total += v.bytes
		if (i >= KEEP || total > BUDGET) {
			store.delete(key)
			delete r.ix.items[key]
		}
	})
	writeIndex(r.d, r.ix)
}

// Saving waits until the browser is idle, and only the newest copy of a chat is written.
type Queued = { ms: Message[]; more: boolean }
const queued = new Map<string, Queued>()
let scheduled = false
const idle: (fn: () => void) => void =
	typeof requestIdleCallback === 'function'
		? (fn) => requestIdleCallback(fn, { timeout: 2000 })
		: (fn) => setTimeout(fn, 300)

function flush() {
	scheduled = false
	const [first] = queued
	if (!first) return
	queued.delete(first[0])
	void write(first[0], first[1])
		.catch(() => {})
		.finally(() => {
			if (queued.size && !scheduled) {
				scheduled = true
				idle(flush)
			}
		})
}

export function saveTranscript(id: string, ms: Message[], more: boolean) {
	queued.set(id, { ms, more })
	if (!scheduled) {
		scheduled = true
		idle(flush)
	}
}

export async function forgetTranscript(id: string) {
	queued.delete(id)
	const r = await ready()
	if (!r) return
	r.d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
	delete r.ix.items[id]
	writeIndex(r.d, r.ix)
}
