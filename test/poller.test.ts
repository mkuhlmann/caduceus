import { beforeEach, expect, test } from 'bun:test'
import { poller } from '@/lib/poller'

// A page whose visibility the test sets.
const page = new EventTarget() as EventTarget & { hidden: boolean }
page.hidden = false
;(globalThis as any).document = page
const setHidden = (hidden: boolean) => {
	page.hidden = hidden
	page.dispatchEvent(new Event('visibilitychange'))
}
beforeEach(() => setHidden(false))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('reads every interval, or after what the read returns', async () => {
	const reads: boolean[] = []
	const p = poller(
		(asked) => {
			reads.push(asked)
			return reads.length === 1 ? 5 : undefined
		},
		{ every: 40, start: true },
	)
	await wait(20)
	expect(reads).toEqual([false, false])
	await wait(40)
	expect(reads).toEqual([false, false, false])
	p.stop()
	await wait(60)
	expect(reads).toHaveLength(3)
})

test('overlapping asks while a read runs make one more read, not one each', async () => {
	let reads = 0
	let release!: () => void
	const p = poller(
		async () => {
			reads++
			if (reads === 1) await new Promise<void>((r) => (release = r))
		},
		{ every: 1000, start: true },
	)
	await wait(5)
	p.now()
	p.now()
	p.soon(10)
	release()
	await wait(30)
	expect(reads).toBe(2)
	p.stop()
})

test('triggers ask for a read; soon never postpones one due earlier', async () => {
	let fire!: () => void
	let unsubscribed = false
	const reads: boolean[] = []
	const p = poller((asked) => void reads.push(asked), {
		every: 1000,
		triggers: [
			(f) => {
				fire = f
				return () => (unsubscribed = true)
			},
		],
	})
	p.soon(10)
	p.soon(500)
	await wait(30)
	expect(reads).toEqual([true])
	fire()
	await wait(10)
	expect(reads).toEqual([true, true])
	p.stop()
	expect(unsubscribed).toBe(true)
})

test('nothing reads while hidden; a read that came due runs when shown, as asked', async () => {
	const reads: boolean[] = []
	const p = poller((asked) => void reads.push(asked), { every: 10 })
	setHidden(true)
	await wait(40)
	expect(reads).toEqual([])
	setHidden(false)
	await wait(5)
	expect(reads).toEqual([true])
	p.stop()
})
