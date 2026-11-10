/**
 * Host half: watches the real agent status and shows a Windows toast.
 *
 * The browser cannot be trusted for this: a background window may never paint a
 * `Notification`, and its permission state is invisible. The turn ends here, so
 * the toast is raised here. The client half owns the preference row and tells
 * this half the mode and whether the window has focus.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOAST_SCRIPT = fileURLToPath(new URL('./toast.ps1', import.meta.url))
const LOG_PATH = join(homedir(), '.dsh', 'reply-notify.log')
const ROUTE = '/__dsh-reply-notify'
/** One turn can settle more than one agent; never stack identical toasts. */
const COALESCE_MS = 800

function log(line) {
try {
mkdirSync(join(homedir(), '.dsh'), { recursive: true })
appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`)
} catch {}
}

function showToast(title, body) {
try {
const child = spawn(
'powershell.exe',
[
'-NoProfile',
'-NonInteractive',
'-ExecutionPolicy',
'Bypass',
'-File',
TOAST_SCRIPT,
'-Title',
title,
'-Body',
body
],
{ windowsHide: true, stdio: 'ignore' }
)
child.on('error', (error) => log(`toast error ${error.message}`))
child.unref()
log(`toast "${title}" / "${body}"`)
} catch (error) {
log(`toast threw ${error?.message ?? error}`)
}
}

/** Test seam: the toast runner is swapped in tests so no real toast appears. */
export const internals = { showToast: (title, body) => showToast(title, body) }

export function apply(ctx) {
/**
 * Nothing has reported yet: assume the window is in the background, so a turn
 * that finishes before the first report is not swallowed.
 */
const state = { mode: 'unfocused', focused: false, reported: false }
/** Session id to the row the sidebar shows, so the toast can name it. */
const sessions = new Map()
/** Session id to the last status seen; only a true to false edge completes. */
const running = new Map()
const recent = new Map()

let routeDisposer
let routeTimer
let routeWarned = false
const startedAt = Date.now()

/**
 * @returns {(() => void) | undefined} The route's own disposer.
 */
function registerRoute(webServer) {
try {
const dispose = webServer.register({ kind: 'prefix', path: ROUTE, handler: onRequest })
log(`state route registered on ${ROUTE}`)
return dispose
} catch (error) {
log(`route registration failed ${error?.message ?? error}`)
return undefined
}
}

/**
 * Register a route that dies with this plugin, so a reload cannot stack a
 * second handler on the same path.
 *
 * @param {import('@deepseek-ai/cordis').Context} host - Context owning the route.
 * @param {object} webServer - The web server service.
 */
function ownRoute(host, webServer) {
const track = typeof host.effect === 'function' ? host.effect.bind(host) : (run) => run()
track(() => {
const dispose = registerRoute(webServer)
return () => {
try {
dispose?.()
} catch {}
}
})
}

/**
 * The web server is another plugin that activates after this one, so the route
 * waits for the service instead of sampling it once while it is still absent.
 */
function mountRoute() {
if (typeof ctx.inject === 'function') {
try {
ctx.inject(['webServer'], (host) => ownRoute(host, host.webServer))
return
} catch (error) {
log(`inject failed, polling instead: ${error?.message ?? error}`)
}
}
const webServer = lookupWebServer()
if (webServer) {
ownRoute(ctx, webServer)
return
}
if (!routeWarned && Date.now() - startedAt > 5000) {
routeWarned = true
log('webServer still missing: the client cannot report its mode')
}
routeTimer = setTimeout(mountRoute, 500)
}

/**
 * Every way a Cordis service can be reached, for the polling fallback.
 *
 * @returns {object | undefined} A service that can register an HTTP route.
 */
function lookupWebServer() {
const candidates = []
try {
candidates.push(ctx.webServer)
} catch {}
try {
candidates.push(ctx.get?.('webServer'))
} catch {}
try {
candidates.push(ctx.reflect?.get?.('webServer'))
} catch {}
try {
candidates.push(ctx.root?.webServer, ctx.root?.get?.('webServer'), ctx.app?.webServer)
} catch {}
return candidates.find((candidate) => candidate && typeof candidate.register === 'function')
}

function onRequest(request, response) {
let body = ''
request.on('data', (chunk) => {
body += chunk
})
request.on('end', () => {
try {
const patch = JSON.parse(body || '{}')
if (patch.mode === 'never' || patch.mode === 'unfocused' || patch.mode === 'always') {
state.mode = patch.mode
}
if (typeof patch.focused === 'boolean') state.focused = patch.focused
if (Array.isArray(patch.sessions)) {
sessions.clear()
for (const row of patch.sessions) {
if (row && typeof row.id === 'string') {
sessions.set(row.id, { title: row.title || '', subagent: row.subagent === true })
}
}
}
if (!state.reported) {
state.reported = true
log(`client connected: mode=${state.mode} focused=${String(state.focused)} sessions=${String(sessions.size)}`)
}
if (patch.test === true) {
log('test toast')
internals.showToast('DSH · 回复完成', '这是一条测试通知')
}
if (patch.log) log(`client: ${String(patch.log)}`)
} catch (error) {
log(`bad payload ${error?.message ?? error}`)
}
response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
response.end('{"ok":true}')
})
}

ctx.on(
'agent/status',
({ agent, status }) => {
const id = String(agent?.id ?? '')
const previous = running.get(id)
running.set(id, status === 'running')
if (status !== 'idle' || previous !== true) return
if (state.mode === 'never') return
if (state.mode === 'unfocused' && state.focused) {
log(`skip ${id} (window focused)`)
return
}
const now = Date.now()
if (now - (recent.get(id) ?? 0) < COALESCE_MS) return
recent.set(id, now)
const row = sessions.get(id)
if (row?.subagent) {
log(`skip ${id} (subagent)`)
return
}
internals.showToast('DSH · 回复完成', row?.title ? `${row.title} · 回复已完成` : '回复已完成')
},
{ global: true }
)

mountRoute()
log(`host ready (route ${ROUTE}, script ${TOAST_SCRIPT})`)

if (routeTimer) {
// polling only: the timer is cleared when the context disposes
if (typeof ctx.effect === 'function') {
ctx.effect(() => () => {
clearTimeout(routeTimer)
})
}
}
}
