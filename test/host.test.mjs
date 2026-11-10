// Host half: the route the client talks to, and the turn-end decision.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { apply, internals } from '../index.js'

const toasts = []
internals.showToast = (title, body) => toasts.push({ title, body })

function mount() {
const handlers = {}
const routes = []
const ctx = {
effect(run) {
const dispose = run()
return typeof dispose === 'function' ? dispose : () => {}
},
get(name) {
if (name !== 'webServer') return undefined
return { register(route) { routes.push(route); return () => {} } }
},
on(name, listener) {
handlers[name] = listener
return () => { delete handlers[name] }
}
}
apply(ctx)
const route = routes.find((entry) => entry.path === '/__dsh-reply-notify')
assert.ok(route, 'state route is registered')
return { handlers, route }
}

function post(route, payload) {
const request = new EventEmitter()
const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body } }
route.handler(request, response)
request.emit('data', JSON.stringify(payload))
request.emit('end')
return response
}

// A completion with the window in the background raises one toast with the title.
{
toasts.length = 0
const { handlers, route } = mount()
const res = post(route, { mode: 'always', focused: false, sessions: [{ id: 's1', title: '修复 bug' }] })
assert.equal(res.status, 200)
handlers['agent/status']({ agent: { id: 's1' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's1' }, status: 'idle' })
assert.equal(toasts.length, 1)
assert.equal(toasts[0].title, 'DSH · 回复完成')
assert.equal(toasts[0].body, '修复 bug · 回复已完成')
}

// A status that never ran is not a completion.
{
toasts.length = 0
const { handlers } = mount()
handlers['agent/status']({ agent: { id: 's2' }, status: 'idle' })
assert.equal(toasts.length, 0)
}

// Never: silent.
{
toasts.length = 0
const { handlers, route } = mount()
post(route, { mode: 'never', focused: false, sessions: [{ id: 's3', title: 'x' }] })
handlers['agent/status']({ agent: { id: 's3' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's3' }, status: 'idle' })
assert.equal(toasts.length, 0)
}

// Unfocused: silent while the window has focus, loud once it does not.
{
toasts.length = 0
const { handlers, route } = mount()
post(route, { mode: 'unfocused', focused: true, sessions: [{ id: 's4', title: 'y' }] })
handlers['agent/status']({ agent: { id: 's4' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's4' }, status: 'idle' })
assert.equal(toasts.length, 0)
post(route, { mode: 'unfocused', focused: false, sessions: [{ id: 's5', title: 'z' }] })
handlers['agent/status']({ agent: { id: 's5' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's5' }, status: 'idle' })
assert.equal(toasts.length, 1)
}

// Subagent sessions stay quiet.
{
toasts.length = 0
const { handlers, route } = mount()
post(route, { mode: 'always', focused: false, sessions: [{ id: 's6', title: 'child', subagent: true }] })
handlers['agent/status']({ agent: { id: 's6' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's6' }, status: 'idle' })
assert.equal(toasts.length, 0)
}

// A session the list has not reported yet still notifies, with the generic body.
{
toasts.length = 0
const { handlers, route } = mount()
post(route, { mode: 'always' })
handlers['agent/status']({ agent: { id: 's7' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's7' }, status: 'idle' })
assert.equal(toasts.length, 1)
assert.equal(toasts[0].body, '回复已完成')
}

// The test button asks the host for a test toast.
{
toasts.length = 0
const { route } = mount()
post(route, { test: true })
assert.equal(toasts.length, 1)
assert.equal(toasts[0].body, '这是一条测试通知')
}

// Two settlements of one turn inside the coalescing window post once.
{
toasts.length = 0
const { handlers, route } = mount()
post(route, { mode: 'always' })
handlers['agent/status']({ agent: { id: 's8' }, status: 'running' })
handlers['agent/status']({ agent: { id: 's8' }, status: 'idle' })
handlers['agent/status']({ agent: { id: 's8' }, status: 'idle' })
assert.equal(toasts.length, 1)
}


{
// The service is a Cordis property on some hosts and only appears after this
// plugin loads; both cases must end up with a registered route.
const routes = []
const ctx = {
effect: (run) => {
const disposer = run()
return typeof disposer === 'function' ? disposer : () => {}
},
get: () => undefined,
on: () => () => {}
}
apply(ctx)
assert.equal(routes.length, 0, 'no route before the service exists')
ctx.webServer = {
register(route) {
routes.push(route)
return () => {}
}
}
await new Promise((resolve) => setTimeout(resolve, 700))
assert.equal(routes.length, 1, 'route registered once the service appears')
assert.equal(routes[0].path, '/__dsh-reply-notify')
}


{
// The web server is another plugin: the route must be registered through
// ctx.inject, which fires once that service is actually available.
const routes = []
const ctx = {
effect: (run) => {
const disposer = run()
return typeof disposer === 'function' ? disposer : () => {}
},
inject: (deps, callback) => {
assert.deepEqual(deps, ['webServer'])
setTimeout(() => callback({ webServer: { register(route) { routes.push(route); return () => {} } } }), 10)
return () => {}
},
on: () => () => {}
}
apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 50))
assert.equal(routes.length, 1, 'route registered through inject')
assert.equal(routes[0].kind, 'prefix')
}

console.log('host.test.mjs: all checks passed')
