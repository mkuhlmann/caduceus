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

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

function messagesFor(id: string, url: URL) {
	const all = transcripts[id] ?? [user(ago(60), 'Hello'), say(ago(59), 'Hi! How can I help?')]
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
		if (p === 'runs') return json({ 'bot-scout': 'run-scout' })
		if (p === 'bots') return json(bots)
		if (p === 'projects') return json([])
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
			if (s) return json({ run_id: s[1], status: 'running' })
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
