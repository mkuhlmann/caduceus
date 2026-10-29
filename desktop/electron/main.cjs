// Caduceus desktop shell. The window is a plain webview; all logic lives in the
// Caduceus relay, which runs as a sidecar bound to 127.0.0.1 on a free port.
// Any other webview wrapper (Tauri, Electrobun, Neutralino) can host it the same way.
const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')

// Portable mode: a file named `portable` next to the executable keeps all data (settings,
// connection, projects, browser storage) in a `data` folder beside it instead of in the user profile.
// It must be set before the app is ready, because Chromium opens its storage at startup.
const exeDir = path.dirname(process.execPath)
const portable = app.isPackaged && fs.existsSync(path.join(exeDir, 'portable'))
if (portable) {
	const root = path.join(exeDir, 'data')
	app.setPath('userData', root)
	app.setPath('sessionData', root)
	app.setPath('logs', path.join(root, 'logs'))
	app.setPath('crashDumps', path.join(root, 'crashes'))
}

let server
let win

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.unref()
		s.on('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})
}

async function waitFor(url, timeoutMs = 15000) {
	const until = Date.now() + timeoutMs
	while (Date.now() < until) {
		try {
			const res = await fetch(url)
			if (res.ok) return
		} catch {}
		await new Promise((r) => setTimeout(r, 150))
	}
	throw new Error(`Caduceus server did not start at ${url}`)
}

function sidecarCommand() {
	if (app.isPackaged) {
		const bin = path.join(
			process.resourcesPath,
			'server',
			process.platform === 'win32' ? 'caduceus-server.exe' : 'caduceus-server',
		)
		return { cmd: bin, args: [], dist: path.join(process.resourcesPath, 'dist') }
	}
	// Development: run the TypeScript server with Bun straight from the repo.
	const root = path.resolve(__dirname, '..', '..')
	return { cmd: process.env.BUN ?? 'bun', args: [path.join(root, 'server', 'index.ts')], dist: path.join(root, 'dist') }
}

async function startServer() {
	const port = await freePort()
	const { cmd, args, dist } = sidecarCommand()
	const dataDir = path.join(app.getPath('userData'), 'relay')
	fs.mkdirSync(dataDir, { recursive: true })
	server = spawn(cmd, args, {
		cwd: dataDir,
		env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CADUCEUS_DATA_DIR: dataDir, CADUCEUS_DIST: dist },
		stdio: ['ignore', 'inherit', 'inherit'],
		windowsHide: true,
	})
	server.on('exit', (code) => {
		if (code && !app.isQuitting) console.error(`Caduceus server exited with code ${code}`)
	})
	const url = `http://127.0.0.1:${port}/`
	await waitFor(url + 'ui-api/auth')
	return url
}

async function createWindow() {
	const url = await startServer()
	win = new BrowserWindow({
		width: 1280,
		height: 840,
		minWidth: 380,
		minHeight: 520,
		backgroundColor: '#151936',
		title: 'Caduceus',
		autoHideMenuBar: true,
		webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
	})
	// Links to the outside world open in the default browser, not inside the app.
	win.webContents.setWindowOpenHandler(({ url: target }) => {
		if (!target.startsWith(url)) shell.openExternal(target)
		return { action: 'deny' }
	})
	win.webContents.on('will-navigate', (e, target) => {
		if (!target.startsWith(url)) {
			e.preventDefault()
			shell.openExternal(target)
		}
	})
	await win.loadURL(url)
}

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	app.on('second-instance', () => {
		if (win) {
			if (win.isMinimized()) win.restore()
			win.focus()
		}
	})
	app.whenReady().then(createWindow)
	app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
	app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
	app.on('before-quit', () => {
		app.isQuitting = true
		server?.kill()
	})
}
