> **AI-assisted project.** This codebase was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author.
> I've run the transcode path and the Arena replacement path end to end against the actual
> software, Resolume Alley 7.27.1 and Arena 7.27.1 on macOS, including converting a live
> composition's h264 clips to DXV and swapping them in place while Arena was running. It's
> **never been used on a real show**, has never run on Windows or Linux, and the only packaged
> build that has been run is the macOS arm64 one. See [Verified vs assumed](#verified-vs-assumed).

# Alleycat

A tray tool that keeps a Resolume show on DXV without anyone having to think about it.

Point it at a folder and it converts anything dropped there. Point it at a running Arena or
Avenue and it'll find the clips that are still h264 (there are always a few), convert them,
and swap the converted file into the composition without any fuss, skipping any clip that's
playing at the time.

## What it does

- **Watches folders.** New footage is probed and, if it isn't already DXV, sent to Alley.
  Files are left alone until they stop growing, so it won't grab something that's still being
  copied onto the show drive.
- **Scans the live show.** It polls the composition over Arena's REST API and queues any clip
  whose codec isn't DXV.
- **Swaps clips in place.** When a conversion finishes, every clip pointing at the original is
  repointed at the DXV copy. Arena keeps in/out points and clip effects across the swap.
- **Never touches a playing clip.** A clip that's connected is left alone and retried once it
  stops. That's the default, because swapping the file under a clip that's on screen is how you
  end up explaining yourself to the director.

## Requirements

- **Resolume Alley**: Alley itself does the conversion, not a bundled encoder. There's no DXV
  encoder in ffmpeg, so Alley's the only way to make DXV.
- **Resolume Arena or Avenue** with the webserver enabled, for the clip-replacement features.
  It's **off by default** (Preferences → Webserver). Alleycat's folder watching works without it.

## How the pieces fit

```
watch folder ─┐
              ├─→ probe (fourcc) ─→ Alley CLI ─→ move to output ─→ Arena /open
show scan ────┘                                                      └─ playing? defer, retry
```

### The Alley command line

Alley hasn't got a documented CLI. It does accept five arguments, though, found in the binary
and checked against 7.27.1:

```
--convertTest  --path <file|folder>  --preset <name>  [--width N --height N]
```

Three of its habits matter, and Alleycat exists partly to put up with them:

1. **Alley never exits.** It converts, then just sits there as a GUI app. There's no exit code
   to wait on, so Alleycat spots completion from the output file settling, then kills the
   process.
2. **Output lands beside the source.** `in.mp4` becomes `in.mov`. If that would collide with the
   source (because the source is itself a `.mov`), Alley appends the preset name instead:
   `c.mov` → `c_DXV High Quality With Alpha.mov`.
3. **`--convertTest` reads as an internal test hook** rather than a supported entry point, so it
   might change between releases.

Because of (2), Alleycat won't convert a file when the name Alley would write is already taken
by something Alleycat didn't make. A folder holding both `clip.mp4` and a separate `clip.mov` is
common, and Alley would overwrite the `.mov` without asking.

### Codec detection

Alleycat reads the video fourcc out of the QuickTime container itself rather than trusting a
display string, matching `DXD*` for the DXV family. It only reads atom headers, so it's a few
small reads even on a 40 GB file.

Arena's own codec strings are used as a _hint_ for the show scan, never as the basis for a
conversion. There are two of them:

- `video.fileinfo.format`, e.g. `DXV 3.0 High Quality, No Alpha`. This is the better one, and
  it's **not in the shipped OpenAPI spec**, though 7.27.1 returns it anyway.
- `video.description`, whose second line is the codec. It's documented, and it's the fallback.

### Addressing a clip is unreliable in two different ways

**Clip ids aren't stable.** Loading a file into a clip gives it a new id, and Arena also
reassigns ids while it finishes opening a composition. So Alleycat re-reads the composition and
matches clips **by path** before every swap, rather than remembering an id.

**`by-id` writes are refused for a while after Arena launches.** The composition reads fine and
`GET .../by-id/{id}` returns 200, but `POST .../by-id/{id}/open` answers `404 the requested clip is
not found` until something has loaded a clip by another route. `by-index` works during that
window, so Alleycat falls back to it, but only after re-reading the clip at those indices and
confirming it still holds the file being replaced. Indices address the _selected deck_, so an
unchecked fallback could drop a file into the wrong slot of a live show.

## Configuration

Plain JSON at `~/Library/Application Support/Alleycat/config.json` (macOS), so you can edit it
by hand when something goes wrong at a show. Everything in it is in the window as well.

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

**Every preview before `v0.1.0-preview.4` fails to show its window on macOS.** Alleycat is a
menu-bar app (`LSUIElement`), and macOS doesn't activate an accessory app when it's launched, so
the window was created and rendered correctly but stayed _behind_ whatever you were looking at,
with `document.visibilityState` reporting `hidden`. Nothing appeared on screen, which you can't
tell apart from the app being broken. It's fixed in `preview.4`, which switches the activation
policy to `regular` while a window is open and drops back to `accessory` when it closes.

**`v0.1.0-preview.1` additionally renders a blank window.** The preload script failed to load, so
the renderer had no bridge to the main process and died on its first call. Fixed in `preview.2`.

## Verified vs assumed

**Verified against real software** (macOS, Alley 7.27.1, Arena 7.27.1):

- The Alley CLI arguments, the never-exits behaviour, and both output-naming rules.
- Conversion end to end: an h264 source came back as a file whose fourcc reads `DXD3`.
- The `--width`/`--height` override, confirmed at 1280x720 from a 320x240 source.
- The fourcc probe, against real ProRes and DXV files, including skipping a leading audio track.
- Arena's REST API: `/product`, `/composition`, and `POST /composition/clips/by-id/{id}/open`.
- All five `connected` states Arena reports: `Empty`, `Disconnected`, `Previewing`, `Connected`,
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
  confirms it renders (tabs, controls, and the preset list read back from a real Alley install),
  but says nothing about whether it _looks_ right.
- **Windows and Linux.** The Alley path default and `predictOutputPath` are written for them and
  unit-tested, but Alley's CLI has only ever been run on macOS here.
- **Only the macOS arm64 build has been run.** The published `v0.1.0-preview.2` arm64 `.dmg` was
  downloaded, verified as `Notarized Developer ID` by `spctl` and stapled, mounted, and the app
  launched the way a user launches it. It converted a file dropped into a watched folder to real
  DXV. The **Windows, Linux and macOS x64** artefacts have never been run at all.
- **The macOS local-network permission still hasn't been seen working.** The key is in the
  shipped bundle and CI asserts it, but Arena wasn't running during the packaged-app test, so the
  one code path that needs the permission never got exercised. A GUI-launched app talking to
  Arena is what would prove it, and that hasn't happened yet.
- **Arena's 412 "clip cannot be changed"** path. The code handles it, but Arena never actually
  returned one during testing; deferral was exercised through the `connected` check instead.
- **Avenue.** Only Arena was tested. Layer _groups_ are Arena-only in the API, but Alleycat
  doesn't use them.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT — see [LICENSE](LICENSE).
