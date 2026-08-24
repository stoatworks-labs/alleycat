# AGENTS.md — Alleycat

Onboarding for an LLM or a newcomer. `CLAUDE.md` is the short command reference; this file is the
_why_. Read [README.md](README.md) first for what the tool does.

## Mental model

Alleycat is three loops sharing one queue:

1. **Watch** — chokidar on configured folders, `awaitWriteFinish` so a file being copied is not
   read half-written.
2. **Scan** — poll Arena's `/composition` every N seconds, queue clips whose codec is not DXV, and
   retry any swap that was deferred.
3. **Convert** — a strictly serial worker. One Alley at a time; it is a GPU app.

Everything lives in `src/main/services/`. The renderer is a read-only view over a `Status` object
plus a config editor; it holds no logic worth testing.

## Load-bearing invariants

- **Never swap a playing clip.** `skipPlayingClips` defaults on. The cost of a false positive is a
  deferred swap; the cost of a false negative is pulling a file out of a live output. `isClipPlaying`
  errs toward "playing" deliberately — it matches `connect`/`preview` and excludes `disconnect`,
  so an unfamiliar future state reads as playing rather than safe.
- **The fourcc probe is the only authority on codec.** Arena's strings are hints for the scan.
  Never convert on the strength of a display string.
- **Match clips by path, not by remembered id.** Clip ids are reassigned when Arena loads a
  composition. `applyPendingReplacements` re-lists clips every time and looks them up by path;
  `StaleClipError` (404) means re-match, not fail.
- **Alley must always be killed.** `convert()` kills in a `finally`. Leaking one per job leaves a
  stack of invisible GUI apps holding the GPU.
- **Do not let Alleycat eat its own output.** Outputs are recorded in `ownOutputs`, and the probe
  would skip them anyway since they are DXV. Both, because either alone is one bug away from a loop.

## Traps

- **Alley's output naming collides.** `x.mp4` → `x.mov`, so a folder holding an unrelated `x.mov`
  loses it. The engine refuses rather than overwriting; do not "fix" this by deleting the existing
  file.
- **`--convertTest` is undocumented** and named like a test hook. If a future Alley drops it,
  `verifyAlley` will not catch that — it only checks the binary exists. Failure will look like a
  conversion that times out with no output.
- **Arena's webserver is off by default.** A "cannot reach Arena" report is usually this, not a bug.
- **`npm install` here leaves Electron with no binary** — this machine blocks install scripts. The
  app then fails with `Error: Electron uninstall`. Extract the zip into `node_modules/electron/dist`
  by hand and write `path.txt` with `printf` (no trailing newline).
- **The renderer's CSP is strict** (`default-src 'self'`). Any CDN font or script will silently not
  load.

## Sibling projects

Nothing shares code with Alleycat yet, but it overlaps in subject with the Resolume plugin fleet in
`~/projects/resolume/`. The Arena REST client here is the only one in the fleet and is a reasonable
starting point if another tool needs one.

## Verified vs assumed

See the [README's section](README.md#verified-vs-assumed) — it is the authoritative list and is
written from what was actually run, not from what the code appears to do. The short version: the
conversion and replacement paths are genuinely exercised against real Alley and real Arena; the
UI has never been looked at, nothing has run on Windows, and it has never been near a real show.
