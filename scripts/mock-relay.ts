/**
 * A stand-in for the Caduceus relay that answers with made-up data: Hermes, six bots, two group chats, a few
 * chats and schedules. Use it for screenshots, demos and UI work without touching a real Hermes, and without
 * real conversations ending up in images.
 *
 *   bunx vite build && bun scripts/mock-relay.ts      # UI and mock API on http://127.0.0.1:7899
 *   CADUCEUS_SERVER=http://127.0.0.1:7899 bunx vite --port 5174   # or: Vite with hot reload in front of it
 *
 * Use its own port (not 5173 or 7811): the app caches chats per origin, so a shared origin would mix real and
 * mock data. `MOCK_PORT` changes the port, `CADUCEUS_DIST` the built UI it serves. Requests it does not know are
 * logged as "unhandled" and answered with a 404, so a new view shows what still needs mocking.
 *
 * Live runs, for clicking through what a reply does as it runs (its log says what reached it):
 *
 *   - A message streams a reply with a tool call, saved to the chat as it goes, as Hermes does.
 *   - "approve" in a message makes the run ask for an approval; it waits until it is answered.
 *   - "drop" in a message breaks the connection once mid-reply, so the browser has to rejoin the stream.
 *   - In a Bot Chat the chat stream says nothing until the end; the turn streams on the bot's watch instead.
 *   - Scout's Bot Chat runs elsewhere and waits for an approval, until it is answered from here.
 *   - curl -X POST 'localhost:7899/ui-api/mock/elsewhere?bot=ops'   a Bot Chat turn from another device, asking
 *     for an approval (`&text=` sets its message)
 *   - curl -X POST localhost:7899/ui-api/mock/drop-watches          the relay loses Hermes' socket: watches end
 *
 * Screenshots at 2x (2880×1800 for a 1440×900 layout), when the browser caps screenshots at 1280 px wide but not
 * in height: set the viewport to 1280×1800, run this in the page, and take one screenshot per offset:
 *
 *   const s = document.head.appendChild(document.createElement('style'))
 *   window.tile = (x) => (s.textContent = `html,body{overflow:hidden!important}#app{position:fixed!important;left:0;
 *     top:0;width:1440px!important;height:900px!important;transform-origin:0 0;transform:scale(2) translateX(-${x}px)}`)
 *   document.activeElement?.blur()   // then wait a moment: the focus border fades
 *   tile(0); tile(640); tile(800)    // one screenshot after each
 *
 * then stitch the three 1280×1800 tiles into a lossless WebP (smaller than PNG or lossy WebP for UI shots):
 *
 *   magick -size 2880x1800 xc:black a.png -geometry +0+0 -composite b.png -geometry +1280+0 -composite \
 *     c.png -geometry +1600+0 -composite -define webp:lossless=true -define webp:method=6 out.webp
 */
import { advance, noMarks, parseMarks } from '../src/lib/read-marks'

const DIST = (process.env.CADUCEUS_DIST ?? new URL('../dist', import.meta.url).pathname).replace(/\/?$/, '/')
const PORT = Number(process.env.MOCK_PORT ?? 7899)
const now = Math.floor(Date.now() / 1000)
const ago = (min: number) => now - min * 60
const iso = (sec: number) => new Date(sec * 1000).toISOString()

const profiles = [
	{
		name: 'default',
		is_default: true,
		model: 'hermes-4-405b',
		provider: 'nous',
		description: 'The main agent.',
		skill_count: 42,
	},
	{
		name: 'ops',
		model: 'hermes-4-405b',
		provider: 'nous',
		description: 'Keeps the homelab running: backups, updates, certificates and disks.',
		skill_count: 18,
	},
	{
		name: 'scout',
		model: 'hermes-4-70b',
		provider: 'nous',
		description: 'Researches anything on the web and reports back with sources.',
		skill_count: 9,
	},
	{
		name: 'quill',
		model: 'hermes-4-405b',
		provider: 'nous',
		description: 'Drafts posts, release notes and emails in your voice.',
		skill_count: 7,
	},
	{
		name: 'inbox',
		model: 'hermes-4-70b',
		provider: 'nous',
		description: 'Sorts the inbox every morning and flags what needs you.',
		skill_count: 5,
	},
	{
		name: 'ledger',
		model: 'hermes-4-70b',
		provider: 'nous',
		description: 'Tracks invoices, subscriptions and the monthly budget.',
		skill_count: 6,
	},
	{
		name: 'chef',
		model: 'hermes-4-70b',
		provider: 'nous',
		description: 'Plans meals around what is in the fridge.',
		skill_count: 4,
	},
]
const meta = (name: string, title: string, shape: string, color: string, extra: Record<string, unknown> = {}) => ({
	name,
	title,
	look: { shape, color },
	image: null,
	hidden: false,
	pinned: false,
	sectionId: null,
	sectionName: null,
	connected: true,
	...extra,
})
const bots = [
	meta('default', '', 'pebble', 'violet'),
	meta('ops', 'Ops', 'cushion', 'orange', { pinned: true }),
	meta('scout', 'Scout', 'star', 'blue'),
	meta('quill', 'Quill', 'heart', 'pink'),
	meta('inbox', 'Inbox Triage', 'drop', 'cyan'),
	meta('ledger', 'Ledger', 'petal', 'green'),
	meta('chef', 'Chef', 'clover', 'brown'),
]

type Msg = Record<string, unknown>
let nextId = 1000
const user = (at: number, content: string): Msg => ({ id: nextId++, role: 'user', content, timestamp: at })
const say = (at: number, content: string): Msg => ({ id: nextId++, role: 'assistant', content, timestamp: at })
const call = (at: number, name: string, args: Record<string, unknown>, output: string, text = ''): Msg[] => {
	const id = `call_${nextId}`
	return [
		{
			id: nextId++,
			role: 'assistant',
			content: text,
			timestamp: at,
			tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
		},
		{ id: nextId++, role: 'tool', content: output, tool_call_id: id, tool_name: name, timestamp: at },
	]
}

const transcripts: Record<string, Msg[]> = {
	'bot-ops': [
		user(ago(95), 'The nightly backup failed. Can you find out why?'),
		...call(
			ago(94),
			'terminal',
			{ command: 'journalctl -u restic-backup --since yesterday --no-pager | tail -20' },
			'Fatal: unable to create lock in backend: repository is already locked by PID 2214 on nas',
		),
		...call(
			ago(94),
			'terminal',
			{ command: 'restic unlock && systemctl start restic-backup' },
			'successfully removed 1 locks',
		),
		say(
			ago(93),
			"A run from the night before crashed and left a **stale lock** on the repository, so last night's backup refused to start. I removed the lock and ran the backup again:\n\n| Host | Snapshot | Added | Duration |\n| --- | --- | --- | --- |\n| nas | `4f2a9c1e` | 1.8 GB | 6 min |\n| media | `b71d03aa` | 214 MB | 2 min |\n| homeassistant | `0c95e7f2` | 38 MB | 31 s |\n\nAll three finished cleanly. I also added a check that clears locks older than 12 hours before each run, so this won't block a night again.",
		),
		user(ago(12), 'Nice. Ask @scout whether a newer restic release is worth upgrading to.'),
		...call(
			ago(12),
			'message_agent',
			{
				to: 'scout',
				message:
					'We run restic 0.17.3 on three hosts. Is a newer release worth upgrading to? Anything that touches locking or repository format?',
			},
			'Delivered to Scout.',
		),
		say(ago(12), "I've asked Scout and will pass on what comes back."),
		user(
			ago(4),
			'Message from 🤖 Scout (@scout): restic 0.18.1 is current. It makes stale locks expire on their own and speeds up prune a lot. The repository format is unchanged, so upgrading is safe. [no reply needed]',
		),
		say(
			ago(3),
			'Scout says **0.18.1** is the current release. It lets stale locks expire on their own, which is exactly what broke last night, and the repository format stays the same.\n\nWant me to upgrade the three hosts tonight, right after the backup window?',
		),
	],
	'bot-scout': [
		user(ago(30), 'Find the three best-reviewed e-bikes under 3,000 euros.'),
		say(ago(28), 'Here is a short list with sources.'),
	],
	'bot-quill': [user(ago(300), 'Draft release notes for 0.4.'), say(ago(290), 'Here is a first draft.')],
	'bot-inbox': [say(ago(180), 'Sorted 46 emails. Three need you today.')],
	'bot-ledger': [say(ago(60 * 26), 'The October budget is closed. You stayed 4% under.')],
	'bot-chef': [say(ago(60 * 50), "This week's plan is ready.")],
	'chat-disk': [
		user(ago(40), 'The media server says /srv is almost full. Can you find out what is taking the space?'),
		...call(ago(39), 'terminal', { command: 'df -h /srv' }, '/dev/sdb1  2.9T  2.7T  150G  95% /srv'),
		...call(
			ago(39),
			'terminal',
			{ command: 'du -sh /srv/* | sort -h | tail -5' },
			'214G /srv/downloads\n402G /srv/backups\n2.1T /srv/media',
		),
		say(
			ago(38),
			'`/srv` is at **95%**. Most of it is expected, but two things stand out:\n\n| Folder | Size | Note |\n| --- | --- | --- |\n| `/srv/media` | 2.1 TB | Your library, as expected |\n| `/srv/backups/old-snapshots` | 402 GB | Snapshots from before the restic migration |\n| `/srv/downloads` | 214 GB | Finished downloads never moved |\n\nRemoving the old snapshots alone would bring usage down to about 84%. Want me to check whether restic still references any of them?',
		),
		user(ago(36), 'Yes, check that, and delete them if nothing uses them.'),
		...call(ago(35), 'terminal', { command: 'restic snapshots --json | jq length' }, '61'),
		...call(ago(35), 'search_files', { pattern: 'old-snapshots', path: '/etc/restic' }, 'No matches'),
		...call(
			ago(34),
			'terminal',
			{ command: 'rm -rf /srv/backups/old-snapshots && df -h /srv' },
			'/dev/sdb1  2.9T  2.3T  552G  81% /srv',
		),
		say(
			ago(34),
			'restic has **no references** to `/srv/backups/old-snapshots`: its repository lives in `/srv/backups/restic` and was initialised after the migration. I deleted the old folder and `/srv` is down to **81%**, with 552 GB free.\n\nThe 214 GB in `/srv/downloads` are all finished. Should I move them into the library?',
		),
	],
}

const botSession = (name: string, minutesAgo: number) => ({
	id: `bot-${name}`,
	source: 'bot_peer_dm',
	title: 'Bot Chat',
	model: 'hermes-4-405b',
	started_at: ago(60 * 24 * 20),
	last_active: ago(minutesAgo),
	message_count: transcripts[`bot-${name}`]?.length ?? 0,
})
const botChats: Record<string, ReturnType<typeof botSession>> = {
	ops: botSession('ops', 3),
	scout: botSession('scout', 1),
	quill: botSession('quill', 290),
	inbox: botSession('inbox', 180),
	ledger: botSession('ledger', 60 * 26),
	chef: botSession('chef', 60 * 50),
}
const chat = (id: string, title: string, minutesAgo: number, source = 'api_server', extra = {}) => ({
	id,
	title,
	source,
	model: 'hermes-4-405b',
	started_at: ago(minutesAgo + 5),
	last_active: ago(minutesAgo),
	message_count: transcripts[id]?.length ?? 6,
	...extra,
})
const chats = [
	chat('chat-deps', 'Update dependencies in caduceus', 60 * 3, 'api_server', { pinned: true }),
	chat('chat-disk', 'Disk usage on the media server', 38),
	chat('chat-train', 'Train times to Hamburg tomorrow', 120, 'telegram'),
	chat('chat-post', 'Draft a post about home automation', 60 * 27),
	chat('chat-meal', 'Weekly meal plan', 60 * 24 * 3, 'matrix'),
	chat('chat-tls', 'Renew TLS certificates', 60 * 24 * 5),
]

// Group chat
const members = [
	{ member_id: 'm-scout', profile: 'scout', handle: 'scout', display_name: 'Scout' },
	{ member_id: 'm-quill', profile: 'quill', handle: 'quill', display_name: 'Quill' },
	{ member_id: 'm-ledger', profile: 'ledger', handle: 'ledger', display_name: 'Ledger' },
]
let seq = 0
const ev = (min: number, kind: string, payload: Record<string, unknown>, actor?: Record<string, unknown>) => ({
	seq: ++seq,
	event_id: `ev-${seq}`,
	kind,
	payload,
	actor,
	created_at: ago(min),
})
const memberMsg = (min: number, m: (typeof members)[number], text: string) =>
	ev(
		min,
		'message.member',
		{ member_id: m.member_id, text },
		{ kind: 'member', id: m.member_id, display_name: m.display_name, profile: m.profile },
	)
const roomEvents = [
	ev(
		22,
		'message.user',
		{
			text: '@all We want a long weekend in Lisbon in March, two people, around 1,200 euros all in. Can you put a plan together?',
		},
		{ kind: 'user' },
	),
	ev(22, 'room.routed', { member_ids: members.map((m) => m.member_id), everyone: true }),
	memberMsg(
		20,
		members[0]!,
		'Flights from Hamburg on Friday morning and back on Monday evening run about **180 euros each** in March. For three nights, these fit the budget:\n\n| Stay | Area | Per night |\n| --- | --- | --- |\n| Casa do Largo | Alfama | 128 € |\n| Lumiares Lofts | Bairro Alto | 145 € |\n| Hotel Lis | Baixa | 112 € |',
	),
	memberMsg(
		18,
		members[2]!,
		'With Casa do Largo that is **744 €** for flights and the room. That leaves about **450 €** for food, the tram and a day trip to Sintra, which is comfortable for three days.',
	),
	memberMsg(
		16,
		members[1]!,
		"Here's a loose plan:\n\n- **Friday:** land around noon, Alfama on foot, sunset at the Miradouro da Graça\n- **Saturday:** day trip to Sintra, dinner in Cais do Sodré\n- **Sunday:** LX Factory and Belém, pastéis at the source\n- **Monday:** slow breakfast, flight home in the evening\n\n@user Should I write it up as a shareable note?",
	),
]
const room = {
	room_id: 'room-lisbon',
	name: 'Lisbon weekend',
	members,
	authority_epoch: 1,
	latest_seq: seq,
	updated_at: ago(16),
}
const room2 = {
	room_id: 'room-release',
	name: 'Release 0.4',
	members: [members[1]!, { member_id: 'm-ops', profile: 'ops', handle: 'ops', display_name: 'Ops' }],
	authority_epoch: 1,
	latest_seq: 2,
	updated_at: ago(60 * 5),
}
const room2Events = [
	{
		seq: 1,
		kind: 'message.user',
		payload: { text: '@all Let us get 0.4 out this week.' },
		actor: { kind: 'user' },
		created_at: ago(60 * 5 + 4),
	},
	{
		seq: 2,
		kind: 'message.member',
		payload: { member_id: 'm-quill', text: 'Release notes are drafted.' },
		actor: { kind: 'member', id: 'm-quill' },
		created_at: ago(60 * 5),
	},
]

// Schedules
const job = (
	id: string,
	name: string,
	display: string,
	nextMin: number,
	lastMin: number,
	status = 'ok',
	enabled = true,
) => ({
	id,
	name,
	prompt: name,
	schedule: { kind: 'cron', display },
	schedule_display: display,
	enabled,
	paused: !enabled,
	state: enabled ? 'scheduled' : 'paused',
	next_run_at: enabled ? iso(now + nextMin * 60) : null,
	last_run_at: iso(now - lastMin * 60),
	last_status: status,
	last_error: status === 'error' ? 'Certificate check could not reach mail.example.com' : null,
	created_at: iso(now - 86400 * 30),
})
const jobs = [
	job('j1', 'Nightly backup report', 'Every day at 02:30', 60 * 9, 60 * 15),
	job('j2', 'Morning briefing', 'Weekdays at 07:00', 60 * 14, 60 * 10),
	job('j3', 'Certificate expiry check', 'Mondays at 09:00', 60 * 24 * 3, 60 * 24 * 4, 'error'),
	job('j4', 'Weekly meal plan', 'Sundays at 17:00', 0, 60 * 24 * 12, 'ok', false),
]

let readMarks = noMarks()

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

/** A chat's messages; one without a story of its own gets a greeting, kept so its ids stay put across reads. */
function transcriptOf(id: string) {
	return (transcripts[id] ??= [user(ago(60), 'Hello'), say(ago(59), 'Hi! How can I help?')])
}

function messagesFor(id: string, url: URL) {
	const all = transcriptOf(id)
	const limit = Number(url.searchParams.get('limit') ?? 120)
	return json({ data: all.slice(-limit), pagination: { limit, offset: 0, order: 'latest', returned: all.length } })
}

function sessionsFor(profile: string, url: URL) {
	const title = url.searchParams.get('title')
	if (profile !== 'default') {
		const s = botChats[profile]
		return json({ data: s && (!title || title === s.title) ? [s] : [], has_more: false })
	}
	return json({ data: title ? [] : chats, has_more: false })
}

function rpc(method: string, params: any) {
	switch (method) {
		case 'groups.capabilities':
			return { driver: true, methods: ['groups.create', 'groups.send', 'groups.list', 'groups.state', 'groups.log'] }
		case 'groups.list':
			return { rooms: [room, room2], next_offset: null }
		case 'groups.state': {
			const r = params.room_id === room.room_id ? room : room2
			return {
				room: r,
				context: { purpose: 'Plan a long weekend in Lisbon', notes: '', routing: 'everyone' },
				driver_status: { running: true, working: false, pending_actions: [], member_activity: [] },
				change_events: true,
			}
		}
		case 'groups.log': {
			const list = params.room_id === room.room_id ? roomEvents : room2Events
			return { events: list.filter((e) => e.seq > (params.since_seq ?? 0)), has_more: false }
		}
		case 'profiles.describe':
			return { skills: [], toolsets: [], mcp_servers: [] }
	}
	console.log('unhandled rpc', method)
	return {}
}

Bun.serve({
	port: PORT,
	hostname: '127.0.0.1',
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url)
		let p = url.pathname
		if (!p.startsWith('/ui-api/')) {
			const f = Bun.file(DIST + (p === '/' ? 'index.html' : p.slice(1)))
			return (await f.exists()) ? new Response(f) : new Response(Bun.file(DIST + 'index.html'))
		}
		p = p.slice('/ui-api/'.length)
		const extra = await scenario(req, url, p)
		if (extra) return extra
		if (p === 'auth') return json({ required: false, authenticated: true })
		if (p === 'connection')
			return json({
				gatewayUrl: 'https://hermes.example.com',
				gatewayKey: '••••',
				dashboardUrl: 'https://hermes.example.com/dash',
				dashboardToken: '',
				dashboardUsername: '',
				dashboardPassword: '',
				envLocked: true,
			})
		if (p === 'connection/test')
			return json({ gateway: { ok: true, status: 200 }, dashboard: { ok: true, status: 200 } })
		if (p === 'runs') return json({ 'bot-scout': 'run-scout', ...activeRuns })
		if (p === 'bots') return json(bots)
		if (p === 'projects') return json([])
		if (p === 'read-marks') {
			if (req.method === 'PATCH') {
				const patch = parseMarks(await req.json())
				if (typeof patch !== 'string') readMarks = advance(readMarks, patch).next
			}
			return json({ marks: readMarks, now: Date.now() / 1000 })
		}
		if (p === 'rpc' && req.method === 'POST') {
			const body: any = await req.json()
			return json({ result: rpc(body.method, body.params ?? {}) })
		}
		if (p === 'rpc/events')
			return new Response(
				new ReadableStream({
					start(c) {
						c.enqueue(new TextEncoder().encode(': hi\n\n'))
					},
				}),
				{ headers: { 'content-type': 'text/event-stream' } },
			)

		// Gateway, optionally under /p/<profile>
		let m = /^gw(?:\/p\/([^/]+))?\/(.*)$/.exec(p)
		if (m) {
			const profile = m[1] ? decodeURIComponent(m[1]) : 'default'
			const rest = m[2]!
			if (rest === 'health') return json({ status: 'ok' })
			if (rest === 'v1/models') return json({ data: [{ id: 'hermes-4-405b' }] })
			if (rest === 'api/sessions') return sessionsFor(profile, url)
			let s = /^api\/sessions\/([^/]+)\/messages$/.exec(rest)
			if (s) return messagesFor(decodeURIComponent(s[1]!), url)
			s = /^api\/sessions\/([^/]+)$/.exec(rest)
			if (s) {
				const id = decodeURIComponent(s[1]!)
				const found = (profile === 'default' ? chats : Object.values(botChats)).find((x) => x.id === id)
				return found ? json({ session: found }) : json({ error: 'not found' }, 404)
			}
			s = /^v1\/runs\/([^/]+)$/.exec(rest)
			if (s && s[1] === 'run-scout')
				return json({
					run_id: 'run-scout',
					status: scoutApproved ? 'running' : 'waiting_for_approval',
					pending_controls: scoutApproved
						? []
						: [
								{
									kind: 'approval',
									prompt_id: 'scout-p1',
									command: 'curl -sL https://example.com/feed.xml | head',
									description: 'Fetch a feed from the web',
								},
							],
				})
			if (s) return json({ run_id: s[1], status: activeRunIds.has(s[1]!) ? 'running' : 'completed' })
			if (rest === 'api/jobs') return json({ jobs })
		}
		m = /^dash\/(.*)$/.exec(p)
		if (m) {
			const rest = m[1]!
			if (rest === 'api/profiles') return json({ profiles })
			if (rest.startsWith('api/cron/jobs')) return json([])
			if (rest === 'api/model/info') return json({ model: 'hermes-4-405b', provider: 'nous' })
			if (rest === 'api/model/options')
				return json({
					providers: [
						{ slug: 'nous', name: 'Nous Portal', is_current: true, models: ['hermes-4-405b', 'hermes-4-70b'] },
					],
					model: 'hermes-4-405b',
					provider: 'nous',
				})
			if (rest === 'api/status') return json({ version: '0.9.0' })
			if (rest.startsWith('api/profiles/projects/tree')) return json({ projects: [] })
		}
		console.log('unhandled', req.method, p)
		return json({ error: 'not mocked' }, 404)
	},
})
console.log(`Mock relay on http://127.0.0.1:${PORT}, serving ${DIST}`)

// ── Live runs (see the header) ─────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const activeRuns: Record<string, string> = {}
const activeRunIds = new Set<string>()
let scoutApproved = false
const waiters = new Map<string, () => void>()
const waitFor = (key: string) => new Promise<void>((r) => waiters.set(key, r))
const release = (key: string) => {
	const r = waiters.get(key)
	waiters.delete(key)
	r?.()
	return !!r
}

type Stream = { frames: string[]; done: boolean; wake: Set<() => void> }
const streams = new Map<string, Stream>()
function push(st: Stream, event: string, data: Record<string, unknown>) {
	const n = st.frames.length
	st.frames.push(`id: ${n}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
	for (const w of st.wake) w()
}
function serve(st: Stream, after: number, dropAt?: number) {
	let i = after + 1
	let wake: () => void
	return new Response(
		new ReadableStream({
			async pull(c) {
				while (i >= st.frames.length && !st.done) await new Promise<void>((r) => st.wake.add((wake = r)))
				st.wake.delete(wake)
				if (i >= st.frames.length) return c.close()
				if (dropAt !== undefined && i === dropAt) {
					console.log('dropping the stream at frame', i)
					return c.error(new Error('dropped'))
				}
				c.enqueue(enc.encode(st.frames[i++]!))
			},
		}),
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

// Bot watches: per bot, the viewers and the turn running now.
type Turn = { generation: number; prompts: Record<string, unknown>[] }
type Watcher = { send: (event: string, data: unknown) => void; close: () => void }
const watchers: Record<string, Set<Watcher>> = {}
const running: Record<string, Turn | undefined> = {}
let generation = 10
const emit = (bot: string, event: string, payload: Record<string, unknown>, gen: number) => {
	for (const w of watchers[bot] ?? []) w.send(event, { payload, generation: gen })
}

function save(id: string, ...ms: Msg[]) {
	transcriptOf(id).push(...ms)
	const s = chats.find((c) => c.id === id) ?? Object.values(botChats).find((c) => c.id === id)
	if (s) s.last_active = Math.floor(Date.now() / 1000)
}

async function botTurn(bot: string, text: string, fromHere: boolean) {
	const id = `bot-${bot}`
	const gen = ++generation
	const turn: Turn = { generation: gen, prompts: [] }
	running[bot] = turn
	activeRuns[id] = `run-${gen}`
	activeRunIds.add(`run-${gen}`)
	if (!fromHere) save(id, user(Math.floor(Date.now() / 1000), text))
	emit(bot, 'message.start', {}, gen)
	await sleep(600)
	emit(bot, 'reasoning.delta', { text: 'Checking what is asked. ' }, gen)
	await sleep(600)
	const callId = `call_${nextId}`
	emit(bot, 'tool.start', { tool_id: callId, name: 'terminal', context: 'uptime', args: { command: 'uptime' } }, gen)
	save(id, {
		id: nextId++,
		role: 'assistant',
		content: '',
		timestamp: Math.floor(Date.now() / 1000),
		tool_calls: [{ id: callId, type: 'function', function: { name: 'terminal', arguments: '{"command":"uptime"}' } }],
	})
	await sleep(1200)
	emit(bot, 'tool.complete', { tool_id: callId, result_text: 'up 12 days' }, gen)
	save(id, { id: nextId++, role: 'tool', content: 'up 12 days', tool_call_id: callId, tool_name: 'terminal' })
	if (/approve/i.test(text)) {
		const prompt = {
			kind: 'approval',
			prompt_id: `p-${gen}`,
			command: 'systemctl restart nginx',
			description: 'Restart the web server',
			execution_generation: gen,
		}
		turn.prompts.push(prompt)
		emit(bot, 'approval.request', prompt, gen)
		await waitFor(`p-${gen}`)
		turn.prompts = []
		await sleep(400)
	}
	const reply = `Done with "${text.slice(0, 40)}". The machine has been up for 12 days.`
	for (const word of reply.split(/(?<= )/)) {
		emit(bot, 'message.delta', { text: word }, gen)
		await sleep(60)
	}
	save(id, say(Math.floor(Date.now() / 1000), reply))
	emit(bot, 'message.complete', { status: 'complete' }, gen)
	running[bot] = undefined
	delete activeRuns[id]
	activeRunIds.delete(`run-${gen}`)
	return reply
}

async function plainRun(id: string, text: string, st: Stream, runId: string) {
	activeRuns[id] = runId
	activeRunIds.add(runId)
	push(st, 'run.started', { run_id: runId, session_id: id })
	await sleep(400)
	push(st, 'hermes.status', { text: 'Thinking' })
	for (const w of 'Let me check that. '.split(/(?<= )/)) {
		push(st, 'assistant.delta', { delta: w })
		await sleep(80)
	}
	const callId = `call_${nextId}`
	push(st, 'tool.started', { tool_name: 'terminal', preview: 'df -h', args: { command: 'df -h /srv' } })
	save(id, {
		id: nextId++,
		role: 'assistant',
		content: 'Let me check that.',
		timestamp: Math.floor(Date.now() / 1000),
		tool_calls: [
			{ id: callId, type: 'function', function: { name: 'terminal', arguments: '{"command":"df -h /srv"}' } },
		],
	})
	await sleep(1000)
	push(st, 'tool.completed', { tool_name: 'terminal' })
	save(id, {
		id: nextId++,
		role: 'tool',
		content: '/dev/sda1 1.8T 1.5T 300G 84% /srv',
		tool_call_id: callId,
		tool_name: 'terminal',
	})
	if (/approve/i.test(text)) {
		push(st, 'approval.request', {
			run_id: runId,
			request_id: `${runId}-a`,
			command: 'rm -rf /srv/tmp/*',
			description: 'Delete temporary files',
		})
		await waitFor(`${runId}-a`)
	}
	const reply = `/srv is at 84%, with 300 GB free. (${text.slice(0, 30)})`
	for (const w of reply.split(/(?<= )/)) {
		push(st, 'assistant.delta', { delta: w })
		await sleep(90)
	}
	save(id, say(Math.floor(Date.now() / 1000), reply))
	push(st, 'assistant.completed', { content: reply })
	push(st, 'run.completed', { usage: { input_tokens: 1200, output_tokens: 80 } })
	st.done = true
	for (const w of st.wake) w()
	delete activeRuns[id]
	activeRunIds.delete(runId)
}

let runs = 0
async function scenario(req: Request, url: URL, p: string): Promise<Response | undefined> {
	let m = /^gw(?:\/p\/[^/]+)?\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(p)
	if (m && req.method === 'POST') {
		const id = decodeURIComponent(m[1]!)
		const body: any = await req.json()
		const text = typeof body.message === 'string' ? body.message : (body.message?.[0]?.text ?? '')
		save(id, user(Math.floor(Date.now() / 1000), text))
		const key = `stream-${++runs}`
		const st: Stream = { frames: [], done: false, wake: new Set() }
		streams.set(key, st)
		const runId = `run-${runs}`
		const bot = id.startsWith('bot-') ? id.slice(4) : null
		if (bot) {
			// A Bot Chat's stream reports nothing until the reply is done; the watch carries the turn.
			push(st, 'run.started', { run_id: runId, session_id: id })
			void botTurn(bot, text, true).then((reply) => {
				push(st, 'assistant.completed', { content: reply })
				push(st, 'run.completed', { usage: { input_tokens: 900, output_tokens: 40 } })
				st.done = true
				for (const w of st.wake) w()
			})
		} else void plainRun(id, text, st, runId)
		const res = serve(st, -1, /drop/i.test(text) ? 6 : undefined)
		res.headers.set('X-Caduceus-Stream', key)
		return res
	}
	m = /^runs\/streams\/([^/]+)$/.exec(p)
	if (m) {
		const st = streams.get(decodeURIComponent(m[1]!))
		if (!st) return json({ error: 'gone' }, 404)
		console.log('rejoin', m[1], 'after', url.searchParams.get('after'))
		return serve(st, Number(url.searchParams.get('after') ?? -1))
	}
	m = /^gw(?:\/p\/[^/]+)?\/v1\/runs\/([^/]+)\/approval$/.exec(p)
	if (m && req.method === 'POST') {
		const body: any = await req.json()
		console.log('approval via run', m[1], body)
		if (m[1] === 'run-scout') scoutApproved = true
		return release(body.request_id) || m[1] === 'run-scout'
			? json({ ok: true })
			: json({ error: { message: 'Not pending', code: 'approval_not_pending' } }, 409)
	}
	m = /^bots\/([^/]+)\/approval$/.exec(p)
	if (m && req.method === 'POST') {
		const body: any = await req.json()
		console.log('approval via socket', m[1], body)
		return release(body.prompt)
			? json({ ok: true })
			: json({ error: { message: 'Not pending', code: 'approval_not_pending' } }, 409)
	}
	m = /^bots\/([^/]+)\/watch$/.exec(p)
	if (m) {
		const bot = decodeURIComponent(m[1]!)
		const turn = running[bot]
		let me: Watcher
		return new Response(
			new ReadableStream({
				start(c) {
					me = {
						send: (event, data) => c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
						close: () => {
							watchers[bot]?.delete(me)
							c.close()
						},
					}
					me.send('ready', {
						session: `hs-${bot}`,
						running: !!turn,
						generation: turn?.generation ?? null,
						prompts: turn?.prompts ?? [],
					})
					;(watchers[bot] ??= new Set()).add(me)
					console.log('watch attached', bot, turn ? `running ${turn.generation}` : 'idle')
				},
				cancel() {
					watchers[bot]?.delete(me)
					console.log('watch closed', bot)
				},
			}),
			{ headers: { 'content-type': 'text/event-stream' } },
		)
	}
	if (p === 'mock/elsewhere' && req.method === 'POST') {
		const bot = url.searchParams.get('bot') ?? 'ops'
		void botTurn(bot, url.searchParams.get('text') ?? 'From my phone: please approve the restart', false)
		return json({ started: bot })
	}
	if (p === 'mock/drop-watches' && req.method === 'POST') {
		// The relay lost Hermes' socket: every watch ends.
		for (const set of Object.values(watchers)) for (const w of [...set]) w.close()
		return json({ ok: true })
	}
	return undefined
}
