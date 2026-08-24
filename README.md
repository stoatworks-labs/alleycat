> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code).
> The transcode path and the Arena replacement path have both been run end to end against real
> software — Resolume Alley 7.27.1 and Arena 7.27.1 on macOS — including converting a live
> composition's h264 clips to DXV and swapping them in place while Arena was running. It has
> **never been used on a real show**, has never run on Windows or Linux, and no packaged build has
> ever been installed. See [Verified vs assumed](#verified-vs-assumed).

# Alleycat

A tray tool that keeps a Resolume show on DXV without anyone having to think about it.

Point it at a folder and it converts anything dropped there. Point it at a running Arena or
Avenue and it will find the clips that are still h264, convert them, and quietly swap the
converted file into the composition — skipping any clip that is currently playing.

## What it does

- **Watches folders.** New footage is probed and, if it is not already DXV, sent to Alley.
  Files are left alone until they stop growing, so copying onto a show drive mid-transfer is safe.
- **Scans the live show.** Polls the composition over Arena's REST API and queues any clip whose
  codec is not DXV.
- **Swaps clips in place.** When a conversion finishes, every clip pointing at the original is
  repointed at the DXV copy. Arena keeps in/out points and clip effects across the swap.
- **Never touches a playing clip.** A clip that is connected is left alone and retried once it
  stops. This is the default and it is the whole reason the tool is careful rather than clever.

## Requirements

- **Resolume Alley** — the conversion is done by Alley itself, not by a bundled encoder. There is
  no DXV encoder in ffmpeg, so Alley is the only way to produce DXV.
- **Resolume Arena or Avenue** with the webserver enabled, for the clip-replacement features.
  It is **off by default**: Preferences → Webserver. Alleycat's folder watching works without it.

## How the pieces fit

```
watch folder ─┐
              ├─→ probe (fourcc) ─→ Alley CLI ─→ move to output ─→ Arena /open
show scan ────┘                                                      └─ playing? defer, retry
```

### The Alley command line

Alley has no documented CLI. It does accept five arguments, found in the binary and verified
against 7.27.1:

```
--convertTest  --path <file|folder>  --preset <name>  [--width N --height N]
```

Three behaviours matter, and Alleycat exists partly to absorb them:

1. **Alley never exits.** It converts, then sits there as a GUI app. There is no exit code to wait
   on, so completion is detected from the output file settling and the process is then killed.
2. **Output lands beside the source.** `in.mp4` becomes `in.mov`. If that would collide with the
   source — because the source is itself a `.mov` — Alley appends the preset name instead:
   `c.mov` → `c_DXV High Quality With Alpha.mov`.
3. **`--convertTest` reads as an internal test hook**, not a supported entry point, so it may
   change between releases.

Because of (2), Alleycat refuses to convert a file when the name Alley would write is already
taken by something Alleycat did not produce — a folder holding both `clip.mp4` and a separate
`clip.mov` is common, and Alley would overwrite the latter without asking.

### Codec detection

Alleycat reads the video fourcc out of the QuickTime container itself rather than trusting a
display string, matching `DXD*` for the DXV family. Only atom headers are read, so it costs a few
small reads even on a 40 GB file.

Arena's own codec strings are used as a _hint_ for the show scan, never as the basis for a
conversion. Two of them exist:

- `video.fileinfo.format`, e.g. `DXV 3.0 High Quality, No Alpha`. This is the better one and it is
  **not in the shipped OpenAPI spec** — 7.27.1 returns it anyway.
- `video.description`, whose second line is the codec. Documented, and the fallback.

### Clip ids are not stable

Arena reassigns clip ids while it finishes opening a composition. An id read during startup can be
dead seconds later, and `/open` then returns 404. Alleycat re-reads the composition and matches
clips **by path** before every swap, so a pending replacement survives a composition reload; a 404
is treated as "stale, re-match next scan" rather than a failure.

## Configuration

Plain JSON at `~/Library/Application Support/Alleycat/config.json` (macOS), editable by hand when
something goes wrong at a show. Everything in it is also in the window.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

The hardware-in-the-loop tests drive Alley for real and are opt-in:

```bash
ALLEYCAT_HW=1 npm test
```

## Known issues

**v0.1.0-preview.1 renders a blank window and should not be used.** The preload script failed to
load, so the renderer had no bridge to the main process and died on its first call. Fixed in
`v0.1.0-preview.2`; the build now fails if the preload the main bundle references does not exist,
and the window shows a named error instead of nothing if the bridge is ever missing again.

## Verified vs assumed

**Verified against real software** (macOS, Alley 7.27.1, Arena 7.27.1):

- The Alley CLI arguments, the never-exits behaviour, and both output-naming rules.
- Conversion end to end: an h264 source came back as a file whose fourcc reads `DXD3`.
- The `--width`/`--height` override, confirmed at 1280x720 from a 320x240 source.
- The fourcc probe, against real ProRes and DXV files, including skipping a leading audio track.
- Arena's REST API: `/product`, `/composition`, and `POST /composition/clips/by-id/{id}/open`.
- All five `connected` states Arena reports — `Empty`, `Disconnected`, `Previewing`, `Connected`,
  `Connected & previewing`.
- The whole loop: a show scan found two h264 clips sharing one file, converted it, and swapped
  both clips in the running composition.
- The deferral cycle: a **connected** clip was converted but not swapped, and was then swapped on
  the next scan tick after it was disconnected.
- Watch-folder ingest, including not re-ingesting its own output.

**Not verified:**

- **Never used on a real show.** Every test above was a synthetic composition with generated test
  patterns.
- **The window has only been checked by dumping its rendered DOM**, not by looking at it. That
  confirms it renders — tabs, controls, and the preset list read back from a real Alley install —
  but says nothing about whether it _looks_ right.
- **Windows and Linux.** The Alley path default and `predictOutputPath` are written for them and
  unit-tested, but Alley's CLI has only ever been run on macOS here.
- **The installers have never been installed.** They are built and published by CI, and the macOS
  ones are checked in the build for `NSLocalNetworkUsageDescription` and `LSUIElement`, but nobody
  has run one on a clean machine.
- **The macOS local-network permission has never been observed working.** The key is present in
  the built bundle, verified with `PlistBuddy`. Every functional test so far ran from a terminal,
  which inherits the terminal's permission — so the permission path itself is untested by
  construction. Double-clicking a packaged build is what would prove it.
- **Arena's 412 "clip cannot be changed"** path. The code handles it, but Arena never actually
  returned one during testing — deferral was exercised through the `connected` check instead.
- **Avenue.** Only Arena was tested. Layer _groups_ are Arena-only in the API, but Alleycat does
  not use them.

## Licence

MIT — see [LICENSE](LICENSE).
