/**
 * Client half: the preference row, and the two facts the host cannot see —
 * which mode the user picked, and whether this window has focus.
 *
 * The toast itself is raised by the host half (index.js), where a turn ends.
 */
window.__ModuleLoader__.load({
id: 'dsh-reply-notify',
factory(require) {
const React = require('react')
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
const VERSION = '0.3.3'
const MODE_KEY = 'dsh-reply-notify.mode'
const MODES = ['never', 'unfocused', 'always']
const DEFAULT_MODE = 'unfocused'
const STYLE_ID = 'dsh-reply-notify-style'
const ENDPOINT = '/__dsh-reply-notify/state'
/** Focus and the session list can change several times per second. */
const REPORT_THROTTLE_MS = 1000
const CSS = `
.dshrn-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}
.dshrn-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}
@media (width<=767px){html:not([data-windows-titlebar]):not([data-platform=darwin]) .dshrn-rowText{padding-right:16px}}
.dshrn-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.dshrn-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.dshrn-selector{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
@media (hover:hover){.dshrn-selector:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dshrn-chevron{flex:none}
`
const COPY = {
en: {
settingsTitle: 'Turn completion notifications',
settingsDesc: 'Set when DSH alerts you that a reply has finished',
modes: { never: 'Never', unfocused: 'Only when unfocused', always: 'Always' },
test: 'Sent'
},
zh: {
settingsTitle: '回答完成通知',
settingsDesc: '设置什么时候提醒你回答已经完成',
modes: { never: '从不', unfocused: '仅窗口不在前台时', always: '始终' },
test: '已发送'
}
}

function normalizeMode(value) {
return MODES.includes(value) ? value : DEFAULT_MODE
}

function readMode() {
try {
return normalizeMode(window.localStorage?.getItem(MODE_KEY))
} catch {
return DEFAULT_MODE
}
}

function writeMode(value) {
try {
window.localStorage?.setItem(MODE_KEY, normalizeMode(value))
} catch {}
}

function detectLanguage() {
let active = ''
try {
active = document.documentElement?.lang || navigator.language || ''
} catch {}
return /^zh/i.test(active) ? 'zh' : 'en'
}

function windowFocused() {
try {
return typeof document.hasFocus === 'function' ? document.hasFocus() : true
} catch {
return true
}
}

/**
 * The section lists rows edge to edge. A row that arrives inside a painted
 * wrapper (plugin rows can be grouped in a card) is peeled back to the same
 * flat surface the built-in rows sit on.
 *
 * @param {HTMLElement | null} node - This row, once mounted.
 */
function flattenAncestors(node) {
if (!node) return
let parent = node.parentElement
for (let depth = 0; depth < 3 && parent; depth += 1) {
const name = typeof parent.className === 'string' ? parent.className : ''
if (name.includes('RmVo8q_section')) return
const fill = getComputedStyle(parent).backgroundColor
if (fill && fill !== 'transparent' && fill !== 'rgba(0, 0, 0, 0)') {
parent.style.background = 'none'
parent.style.border = '0'
parent.style.borderRadius = '0'
parent.style.padding = '0'
parent.style.margin = '0'
return
}
parent = parent.parentElement
}
}

function createSettingsRow(languageOf, onModeChange) {
return function SettingsRow() {
const copy = COPY[languageOf()]
const [mode, setMode] = React.useState(readMode)
const [open, setOpen] = React.useState(false)
const selectorRef = React.useRef(null)
const options = MODES.map((value) => ({ id: value, label: copy.modes[value] }))
const selectMode = (id) => {
selectorRef.current?.focus?.({ preventScroll: true })
setOpen(false)
const next = normalizeMode(id)
writeMode(next)
setMode(next)
onModeChange()
}
const selector = React.createElement(
'button',
{
ref: selectorRef,
type: 'button',
className: 'dshrn-selector',
'aria-haspopup': 'menu',
'aria-expanded': open,
onClick: () => setOpen((value) => !value)
},
copy.modes[mode],
React.createElement(primitives.IconChevronDownOutlineRegular, { className: 'dshrn-chevron' })
)
return React.createElement(
'div',
{ className: 'dshrn-row', ref: flattenAncestors },
React.createElement(
'div',
{ className: 'dshrn-rowText' },
React.createElement('div', { className: 'dshrn-title' }, copy.settingsTitle),
React.createElement('div', { className: 'dshrn-desc' }, copy.settingsDesc)
),
React.createElement(primitives.Menu, {
open,
onClose: () => setOpen(false),
items: options,
selectedId: mode,
onSelect: selectMode,
align: 'end',
portal: true,
anchor: selector
})
)
}
}

/**
 * @param {object} ctx - Client plugin context.
 * @returns {() => void} disposer
 */
function start(ctx) {
const disposers = []
let disposed = false
let reportTimer = 0
let bound = false
const focused = windowFocused()

/** Cordis services are reachable three ways depending on how the plugin is mounted. */
function service(name) {
try {
const direct = ctx.get?.(name)
if (direct !== undefined) return direct
const reflected = ctx.reflect?.get?.(name)
if (reflected !== undefined) return reflected
return ctx[name]
} catch {
return undefined
}
}

function post(payload) {
try {
return fetch(ENDPOINT, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify(payload),
keepalive: true
})
} catch {
return Promise.resolve()
}
}

function currentSessions() {
const list = service('sessions')?.list
const snapshot = list?.getSnapshot?.()
const rows = snapshot?.byId ?? {}
const out = []
for (const id of Object.keys(rows)) {
const row = rows[id]
if (!row || typeof row.id !== 'string') continue
out.push({
id: row.id,
title: row.displayTitle ?? row.title ?? '',
subagent: row.origin === 'subagent'
})
}
return out
}

const state = { focused }

function report(extra) {
if (disposed) return
post({ mode: readMode(), focused: state.focused, sessions: currentSessions(), ...extra })
}

function scheduleReport() {
if (disposed || reportTimer) return
reportTimer = setTimeout(() => {
reportTimer = 0
report()
}, REPORT_THROTTLE_MS)
}

function onFocus() {
state.focused = true
report()
}

function onBlur() {
state.focused = false
report()
}

function bind() {
if (disposed || bound) return
const list = service('sessions')?.list
if (typeof list?.subscribe === 'function' && typeof list?.getSnapshot === 'function') {
const off = list.subscribe(scheduleReport)
bound = true
disposers.push(typeof off === 'function' ? off : () => {})
return
}
setTimeout(bind, 1500)
}

function mountSettings() {
const slots = service('slots')
if (!slots?.inject) return
const done = slots.inject('settings.general.item', () =>
slots.register(
{ name: 'settings.general.item', id: 'dsh-reply-notify', order: 21 },
createSettingsRow(detectLanguage, () => report())
)
)
if (typeof done === 'function') disposers.push(done)
}

function mountStyles() {
try {
if (!document.getElementById(STYLE_ID)) {
const style = document.createElement('style')
style.id = STYLE_ID
style.textContent = CSS
document.head.appendChild(style)
}
} catch {}
}

const api = {
version: VERSION,
mode: readMode,
test() {
report({ test: true })
return COPY[detectLanguage()].test
}
}
window.__dshReplyNotify = api

mountStyles()
mountSettings()
bind()
window.addEventListener('focus', onFocus)
window.addEventListener('blur', onBlur)
report()

return () => {
disposed = true
if (reportTimer) clearTimeout(reportTimer)
for (const dispose of disposers) {
try {
dispose()
} catch {}
}
window.removeEventListener('focus', onFocus)
window.removeEventListener('blur', onBlur)
if (window.__dshReplyNotify === api) delete window.__dshReplyNotify
}
}

return {
inject: ['uiSession', 'slots'],
apply(ctx) {
let dispose
try {
dispose = ctx.effect(() => start(ctx), 'dsh-reply-notify: settings + focus reporter')
} catch {
dispose = start(ctx)
}
if (typeof dispose === 'function') {
ctx.effect(() => dispose, 'dsh-reply-notify: teardown')
}
}
}
}
})
