# Notes

Working notes for this repo: status, decisions, and the traps that have actually bitten.
Migrated out of Claude Code's memory on 2026-08-24, so they are written in the first
person and dated by when each thing was learned — that date is usually the useful part.

Cross-cutting notes that are not specific to this repo live in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).

*Alleycat — Electron tray app that watches folders, transcodes to DXV with Alley, and swaps clips in a live Arena show; PUBLIC, verified end to end, never used on a show*

**PUBLIC** at `github.com/stoatworks-labs/alleycat`, local at `~/projects/resolume/alleycat`.
Created 2026-08-24, v0.1.0. **Electron** (first tray app in the Electron half of the fleet —
av-launcher is the Tauri one), electron-vite + React, house scaffolding copied from animATEM.

Three loops over one serial queue: chokidar watch folders; a poll of Arena's `/composition` for
non-DXV clips; and a strictly one-at-a-time Alley worker.

## Decisions the user made

- **Electron**, not Tauri.
- **Auto-replace, but never a playing clip** — deferred and retried on the next scan tick.
- **Public from the first commit.**

## Verified end to end (Alley 7.27.1 + Arena 7.27.1, macOS)

Conversion produces a real `DXD3` file; a show scan found two h264 clips sharing one source,
converted it and swapped **both**; a **connected** clip was converted but *not* swapped, then
swapped once disconnected. Watch-folder ingest works and does not re-ingest its own output.
46 unit tests plus 2 opt-in hardware tests (`ALLEYCAT_HW=1 npm test`).

## NOT verified

**Never used on a real show.** Nothing has run on **Windows or Linux**, or on **macOS x64**.
The published macOS **arm64** dmg has been verified (`spctl` → `Notarized Developer ID`, stapler
ok) and the app GUI-launched from it, where it converted a dropped file to real DXV — so the
packaged path works at least on that one artefact. **That test proved the main process worked and
nothing about the window**, which was invisible the whole time; see the LSUIElement note below. Arena's **412** path is coded but never actually fired. **Avenue
untested.** The macOS local-network permission is declared and asserted in CI but has still never
been *observed working*: Arena was not running during the packaged-app test, so the one path that
needs the permission was never exercised. A GUI-launched app talking to Arena would prove it.

The window is now checked by dumping its rendered DOM (see below), which is real evidence that it
renders — but nobody has looked at whether it looks *right*.

## Key design points

Codec is decided by reading the QuickTime fourcc directly (`DXD*` prefix), never from Arena's
display strings — see [arena rest api traps](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_arena_rest_api_traps.md). Clips are matched **by path**, because
clip ids are reassigned on composition load. The engine **refuses** to convert when Alley's output
name would clobber an existing unrelated file — see [resolume alley cli](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_resolume_alley_cli.md).

Getting it to run needed the [npm postinstall blocked](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_npm_postinstall_blocked.md) workaround.

## Released — 2026-08-24

**v0.1.0-preview.1**, then **v0.1.0-preview.2** hours later to fix a fatal bug (below).
Pre-releases, titled `Alleycat vX (preview)`, 13 assets per release built by GitHub Actions across
macOS/Windows/Linux.

Both had to be signed **by hand afterwards** with `posthoc-sign.sh` — the auto-signer follows
GitHub's "latest", which excludes pre-releases, so nothing signs a preview on its own. See
[prerelease signing blindspot](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_prerelease_signing_blindspot.md).
8 notarisations per release, all 6 macOS assets re-uploaded in place.

Deliberately **not** done, because a preview of a brand-new project has nowhere to drift from:
no `gen-downloads.py` (it keys off "latest" and correctly ignores pre-releases), no website
project page, no user guide, no video, no About window. Every other home in the release workflow
is still *empty* for this repo — the first **stable** release is where they have to be created
rather than updated.

## ☠️ preview.1 shipped a completely blank window

`"type": "module"` in package.json — which **no other Electron app in the fleet sets**, all seven
were checked and are `commonjs` + `preload/index.js` — makes electron-vite emit the preload as
`out/preload/index.mjs` while `src/main/index.ts` asks for `index.js`. The preload never loads,
`window.alleycat` is undefined, the renderer throws on its first call, and React unmounts the tree.

**Everything was green while it was completely broken:** typecheck, lint, 46 tests, three-platform
CI and the app's own log all passed, because the mismatch exists only between two *build outputs*
and **renderer errors never reach the main process's stdout**. I claimed earlier in that session
that "the renderer loaded clean, no CSP violations" — that was drawn from main-process stdout alone
and was worthless as evidence. Allan found it by opening the window.

Three guards now, all worth copying to any Electron repo:

1. `scripts/check-bundle.mjs` reads the preload path out of the **built** main bundle and asserts
   the file exists. Runs inside `npm run build` and in both workflows.
2. `src/main/index.ts` forwards renderer `console-message` / `did-fail-load` /
   `render-process-gone` into the app log. Without these a blank window is silent. Do not remove.
3. The renderer renders a named error instead of nothing when the bridge is missing.

**To verify a renderer actually rendered, without a screenshot**, dump the DOM from the main
process: `win.webContents.executeJavaScript('document.getElementById("root")?.innerText')`.
Text-based, scriptable, and far better evidence than "the process is still alive".

## UI: the header sat under the macOS window controls — 2026-08-24

`titleBarStyle: 'hiddenInset'` draws close/minimise/zoom **inside** the content area, so the
"Alleycat" title was rendered underneath them. Allan spotted it in `v0.1.0-preview.2`.

The fix has to be platform-scoped — Windows and Linux use a normal title bar and would just get a
dented header — so `main.tsx` stamps `document.documentElement.dataset.platform` from the preload
bridge **before the first render** (in an effect it would visibly jump on every launch), and the
CSS pads the header only under `:root[data-platform='darwin']`.

**I shipped two visual bugs in a row without ever looking at the window**, which is the actual
lesson. Screenshotting this app is awkward: it is `LSUIElement`, so it has no dock icon, and full
screen captures kept catching whatever else was on screen — one of them caught Allan's own screen
while he was using the machine, at which point I stopped. Forcing the window frontmost with
`app.focus({ steal: true })` behind a temporary env var worked once, and is the approach to reuse —
but only when the machine is idle. Dumping the DOM proves it *rendered*; it says nothing about
whether it *looks* right.

## Arena's by-id write is refused on a cold start — 2026-08-24

Found while seeding clips for those screenshots, and it corrects what this repo previously
believed. `POST /clips/by-id/{id}/open` 404s for a window after Arena launches even when ids are
stable and `GET by-id` returns 200; every by-index route works in that same window. Details and the
full route table are in
[arena rest api traps](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_arena_rest_api_traps.md).

`ArenaClient.openFileForClip` now falls back to by-index — **after** re-reading the clip at those
indices and confirming it still holds the file being replaced. Indices address the *selected deck*,
so an unguarded fallback could drop a file into the wrong slot of a live show. There is a test
asserting that case performs no write at all.

Shipped in **v0.1.0-preview.3**. The fallback is covered by unit tests but has **not** been
exercised against a real cold Arena.

## ☠️ LSUIElement made the window invisible on every launch — 2026-08-24

Reported as "the latest release renders no UI". It was not a rendering fault at all: reading the
live DOM of the **shipped** `preview.3` over CDP showed a complete, correct page —
`v0.1.0-preview.3`, 2258 characters of markup, bridge present — while
`document.visibilityState` was `hidden` and `document.hasFocus()` was `false`, with Chrome
frontmost. The window was being created behind everything and never coming forward.

Cause: `LSUIElement: true`, added in preview.1's release plumbing so a menu-bar tool would not carry
a dock icon. macOS **does not activate an accessory app** when it is launched, so `win.show()`
renders into a window nobody can see. Affected preview.1, .2 and .3 — every build that had ever
shipped. It is also why screenshotting this app kept failing earlier in the same session, and why a
temporary `app.focus({ steal: true })` was needed to capture it; that was the bug showing itself and
I read it as a screenshot problem.

What actually works, measured rather than assumed — each of these was verified over CDP with another
app frontmost:

- `app.focus({ steal: true })` alone: **does not work**. Still `hidden`, Chrome still frontmost.
- `app.setActivationPolicy('regular')` + `app.dock.show()` + focus **in the same tick**: works on a
  cold launch, **fails on re-open** of an already-running instance.
- The same, with the focus **deferred ~120ms** after the policy change, plus a brief
  `setAlwaysOnTop(true)` dropped again after 500ms: works for **both** cold launch and re-open.

The app drops back to `accessory` when the last window closes, so it is menu-bar-only while idle and
a normal app while its window is open — which is also the honest description of what it is.

`app.requestSingleInstanceLock()` + `second-instance` was added at the same time: without it a
second launch of an accessory app is swallowed entirely — no new process, no dock icon to bounce,
nothing on screen.

**The lesson is about evidence.** "The process is alive", "it converted a file" and even "the DOM is
correct" are all true of an app the user cannot see. The only check that would have caught this is
whether the window is actually *visible and frontmost*, which is one CDP call:
`document.visibilityState` and `document.hasFocus()`. Launching with
`--remote-debugging-port=<n> --remote-allow-origins='*'` works on the shipped bundle and needs no
patching — which matters, because macOS App Management refuses to let you modify a notarised app.

Shipped in **v0.1.0-preview.4**.
