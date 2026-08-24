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

**Never used on a real show.** **The window has never been visually looked at** — it loads with no
renderer or CSP errors, but two screenshot attempts missed (captured the wrong window; Quartz is
unavailable to system python3) and were abandoned per **screenshot capture** (working-practice note, kept in Claude memory). Nothing has
run on **Windows or Linux**. **No packaged build has been produced.** Arena's **412** path is coded
but never actually fired. **Avenue untested.**

## Key design points

Codec is decided by reading the QuickTime fourcc directly (`DXD*` prefix), never from Arena's
display strings — see [arena rest api traps](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_arena_rest_api_traps.md). Clips are matched **by path**, because
clip ids are reassigned on composition load. The engine **refuses** to convert when Alley's output
name would clobber an existing unrelated file — see [resolume alley cli](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_resolume_alley_cli.md).

Getting it to run needed the [npm postinstall blocked](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_npm_postinstall_blocked.md) workaround.
