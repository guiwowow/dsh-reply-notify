// Client half: the General-page row, and what it reports to the host.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function ReactStub() {}
ReactStub.createElement = (type, props, ...children) => ({
type,
props: props ?? {},
children: children.flat()
})
ReactStub.useState = (initial) => [
typeof initial === 'function' ? initial() : initial,
() => {}
]
ReactStub.useRef = (initial) => ({ current: initial })

function mount({ focused = false, lang = 'zh', rows = {}, stored = [] } = {}) {
const posts = []
const listeners = new Map()
const listListeners = new Set()
const store = new Map(stored)
const timers = []
const registered = []

const loaded = []
const window = {
__ModuleLoader__: { load: (definition) => loaded.push(definition) },
localStorage: {
getItem: (key) => (store.has(key) ? store.get(key) : null),
setItem: (key, value) => store.set(key, String(value))
},
addEventListener: (name, fn) => listeners.set(name, fn),
removeEventListener: (name) => listeners.delete(name)
}
const document = {
documentElement: { lang },
hasFocus: () => focused,
getElementById: () => null,
createElement: () => ({ id: '', textContent: '' }),
head: { appendChild() {} }
}
const sessions = {
list: {
getSnapshot: () => ({ ids: Object.keys(rows), byId: rows, phase: 'ready' }),
subscribe: (listener) => {
listListeners.add(listener)
return () => listListeners.delete(listener)
}
}
}
const slots = {
inject(name, factory) {
registered.push({ name, ...factory() })
return () => {}
},
register(meta, component) {
return { meta, component }
}
}
const ctx = {
get: (name) => (name === 'slots' ? slots : name === 'sessions' ? sessions : undefined),
effect: (run) => run()
}

vm.runInNewContext(source, {
window,
document,
navigator: { language: lang === 'zh' ? 'zh-CN' : 'en-US' },
getComputedStyle: () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' }),
fetch: (url, init) => {
posts.push({ url, body: JSON.parse(init.body) })
return Promise.resolve({ ok: true })
},
setTimeout: (fn) => {
timers.push(fn)
return timers.length
},
clearTimeout: () => {},
console
})
const module = loaded[0]
const primitives = {
Menu: function Menu() {},
IconChevronDownOutlineRegular: function Icon() {}
}
module.factory((specifier) => (specifier === 'react' ? ReactStub : primitives)).apply(ctx)

return { posts, listeners, listListeners, store, registered, window, timers }
}

// The loader receives the module factory and React is what it asks for.
{
const app = mount()
assert.equal(typeof app.window.__dshReplyNotify, 'object')
assert.equal(app.window.__dshReplyNotify.version, packageVersion)
}

// The row is title + description + the three-option select, registered in General.
{
const app = mount()
const entry = app.registered.find((item) => item.name === 'settings.general.item')
assert.ok(entry, 'registered in settings.general.item')
assert.equal(entry.meta.id, 'dsh-reply-notify')
assert.equal(entry.meta.order, 21)
const row = entry.component({})
assert.equal(row.props.className, 'dshrn-row')
const copy = row.children[0]
assert.equal(copy.children[0].children[0], '回答完成通知')
assert.equal(copy.children[1].children[0], '设置什么时候提醒你回答已经完成')
const menu = row.children[1]
assert.equal(menu.props.selectedId, 'unfocused')
assert.deepEqual([...menu.props.items.map((item) => item.label)], ['从不', '仅窗口不在前台时', '始终'])
assert.equal(menu.props.anchor.type, 'button')
assert.equal(menu.props.anchor.props.className, 'dshrn-selector')
assert.equal(menu.props.anchor.children[0], '仅窗口不在前台时')
}

// The first report carries the mode, the focus state, and the session rows.
{
const app = mount({ rows: { s1: { id: 's1', displayTitle: '修复登录', running: true } } })
assert.equal(app.posts.length, 1)
assert.equal(app.posts[0].url, '/__dsh-reply-notify/state')
assert.equal(app.posts[0].body.mode, 'unfocused')
assert.equal(app.posts[0].body.focused, false)
assert.deepEqual(app.posts[0].body.sessions, [{ id: 's1', title: '修复登录', subagent: false }])
}

// Picking a mode persists it and tells the host right away.
{
const app = mount()
const entry = app.registered.find((item) => item.name === 'settings.general.item')
const menu = entry.component({}).children[1]
menu.props.onSelect('always')
assert.equal(app.store.get('dsh-reply-notify.mode'), 'always')
const last = app.posts.at(-1)
assert.equal(last.body.mode, 'always')
}

// Focus changes are reported, so "only when unfocused" means what it says.
{
const app = mount()
app.posts.length = 0
app.listeners.get('blur')()
assert.equal(app.posts.at(-1).body.focused, false)
app.listeners.get('focus')()
assert.equal(app.posts.at(-1).body.focused, true)
}

// The console probe asks the host for a test toast.
{
const app = mount()
app.posts.length = 0
assert.equal(app.window.__dshReplyNotify.test(), '已发送')
assert.equal(app.posts.at(-1).body.test, true)
}

// A new session row is reported once, not once per change.
{
const app = mount()
app.posts.length = 0
for (const listener of app.listListeners) listener()
for (const listener of app.listListeners) listener()
assert.equal(app.posts.length, 0, 'throttled until the timer fires')
assert.ok(app.timers.length > 0, 'a report is scheduled')
app.timers.pop()()
assert.equal(app.posts.length, 1)
}

console.log('client.test.mjs: all checks passed')
