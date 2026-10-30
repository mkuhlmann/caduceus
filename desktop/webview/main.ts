// Caduceus desktop app: the relay and a native window in one executable, without shipping a browser.
// The window is the system webview (WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS).
// Its event loop blocks this thread once it runs, so the relay lives in a worker.
import { dlopen, FFIType, ptr } from 'bun:ffi'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const packaged = import.meta.path.includes('$bunfs') || import.meta.path.includes('~BUN')

// Portable mode: a file named `portable` next to the executable keeps all data (connection, projects,
// browser storage) in a `data` folder beside it instead of in the user profile. The location matches
// the earlier Electron shell, so an existing connection carries over.
function userDataDir() {
	const exeDir = dirname(process.execPath)
	if (packaged && existsSync(join(exeDir, 'portable'))) return join(exeDir, 'data')
	const home = homedir()
	if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Caduceus')
	if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Caduceus')
	return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Caduceus')
}

const dataDir = userDataDir()
const relayDir = join(dataDir, 'relay')
mkdirSync(relayDir, { recursive: true })

// WebView2 keeps its profile in %APPDATA%\<exe name> unless told otherwise. It reads this variable
// from the process environment, which `process.env` does not write through to.
if (process.platform === 'win32') {
	const kernel32 = dlopen('kernel32.dll', {
		SetEnvironmentVariableW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
	})
	const wide = (s: string) => ptr(Buffer.from(s + '\0', 'utf16le'))
	kernel32.symbols.SetEnvironmentVariableW(wide('WEBVIEW2_USER_DATA_FOLDER'), wide(join(dataDir, 'webview')))
}

/**
 * Browser storage (theme, cached probes) belongs to the page's origin, port included. A port derived
 * from the data folder stays the same between launches, so those settings survive a restart.
 */
async function pickPort() {
	const preferred = 20000 + (Bun.hash.crc32(dataDir) % 40000)
	return (await tryListen(preferred)) ?? (await tryListen(0))!
}

function tryListen(port: number) {
	return new Promise<number | null>((done) => {
		const s = createServer()
		s.once('error', () => done(null))
		s.listen(port, '127.0.0.1', () => {
			const { port } = s.address() as { port: number }
			s.close(() => done(port))
		})
	})
}

async function waitFor(url: string, timeoutMs = 15000) {
	const until = Date.now() + timeoutMs
	while (Date.now() < until) {
		try {
			if ((await fetch(url)).ok) return
		} catch {}
		await Bun.sleep(150)
	}
	throw new Error(`The Caduceus relay did not start at ${url}.`)
}

const port = await pickPort()
const url = `http://127.0.0.1:${port}/`
const relay = new Worker(new URL('./server.ts', import.meta.url).href, {
	env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CADUCEUS_DATA_DIR: relayDir },
} as WorkerOptions)

let startError = ''
relay.addEventListener('error', (e) => (startError ||= e.message))
try {
	await waitFor(url + 'ui-api/auth')
} catch (e) {
	startError ||= (e as Error).message
}

// Loaded only now, because loading it opens the system webview library: on Linux that needs GTK 4 and
// WebKitGTK 6.0, and a missing library should end in a readable message instead of a crash.
let lib: typeof import('webview-bun')
try {
	lib = await import('webview-bun')
} catch (e) {
	console.error(`Caduceus could not open its window: ${(e as Error).message}`)
	if (process.platform === 'linux')
		console.error(
			'It needs GTK 4 and WebKitGTK 6.0. On Debian or Ubuntu: sudo apt install libgtk-4-1 libwebkitgtk-6.0-4',
		)
	process.exit(1)
}

// Size hints by value (none, minimum): `SizeHint` is a const enum and does not exist at runtime.
const webview = new lib.Webview(process.env.CADUCEUS_DEVTOOLS === '1', { width: 1280, height: 840, hint: 0 })
webview.size = { width: 380, height: 520, hint: 1 }
webview.title = 'Caduceus'

// Links to the outside world open in the default browser, not inside the app.
webview.bind('caduceusOpenExternal', (target: string) => {
	if (!/^(https?|mailto):/i.test(target)) return
	const cmd =
		process.platform === 'win32'
			? ['rundll32.exe', 'url.dll,FileProtocolHandler', target]
			: [process.platform === 'darwin' ? 'open' : 'xdg-open', target]
	Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
})
webview.init(`(() => {
	const external = (href) => {
		try {
			const u = new URL(href, location.href)
			return u.origin !== location.origin && /^(https?|mailto):$/.test(u.protocol) ? u.href : null
		} catch { return null }
	}
	document.addEventListener('click', (e) => {
		const a = e.target instanceof Element && e.target.closest('a[href]')
		const target = a && external(a.getAttribute('href'))
		if (!target) return
		e.preventDefault()
		window.caduceusOpenExternal(target)
	}, true)
	const open = window.open
	window.open = (href, ...rest) => {
		const target = href && external(String(href))
		if (!target) return open.call(window, href, ...rest)
		window.caduceusOpenExternal(target)
		return null
	}
})()`)

if (startError) {
	const escape = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
	webview.setHTML(
		`<body style="font:15px system-ui;background:#151936;color:#e8e6df;padding:2rem;max-width:72ch">` +
			`<h1 style="font-size:1.25rem">Caduceus could not start</h1>` +
			`<p>The built-in relay did not come up: ${escape(startError)}</p>` +
			`<p>Close this window and open Caduceus again. If it keeps happening, start it from a terminal to see the full log.</p>`,
	)
} else {
	webview.navigate(url)
}

// Blocks until the window closes.
webview.run()
relay.terminate()
process.exit(0)
