# DSH Reply Notifications

A desktop notification when a turn finishes — the one thing Codex and ChatGPT do that DSH did not.

Settings → General → **回答完成通知 / Turn completion notifications**:

| Option | Behaviour |
| --- | --- |
| 从不 / Never | Silent |
| 仅窗口不在前台时 / Only when unfocused | Notifies only while the DSH window is in the background |
| 始终 / Always | Notifies even when the window is in front |

## Install

Windows + DSH desktop 0.2.2-rc.1 or newer.

- From the plugin market, once listed: search `dsh-reply-notify`.
- Manually: copy this folder into `~/.dsh/plugins/src/`, install it as a bundle in the desktop profile, then restart DSH once — the host half only loads at boot.

## How it works

- **Host half** (`index.js`) listens to the host's `agent/status` event. A turn that goes `running → idle` raises a Windows toast through `toast.ps1` (WinRT, AppUserModelId `electron.app.DeepSeek Harness`, the identity of the installed app — a custom AUMID gets its own notification setting that Windows can switch off).
- **Client half** (`client.js`) draws the settings row and reports the two facts the host cannot see: the selected mode, and whether the window has focus. It posts them to `/__dsh-reply-notify/state`.
- Subagent sessions stay quiet. One turn raises one toast.
- The browser `Notification` API is deliberately not used: in the desktop shell it silently no-ops.

## Log

`%USERPROFILE%\.dsh\reply-notify.log` — one line per decision (`skip … (window focused)`, `toast "…"`, `ps: shown`).

## Debug

Console: `__dshReplyNotify.test()` asks the host for one test toast.

## Structure

```
index.js          host half: agent/status → toast
toast.ps1         WinRT toast, logs its own failures
client.js         settings row + mode/focus reporter
locale/*.json     meta title and description
test/             host and client suites, no build step
```
