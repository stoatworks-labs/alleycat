# Attributions

Alleycat is built on other people's work. This file lists what that work is, who did
it, and what it is doing here.

It is generated — the master lists live in the `stoatworks-backend` repo and are
pushed out by `scripts/sync-attributions.py`. Edit it there, not here.

## Code we derived from other people's work

Someone else solved this first, and this project would not exist in its current form without their work.

### House scaffolding — Stoatworks animATEM

<https://github.com/stoatworks-labs/animATEM>  
Licence: MIT  
Copyright: Stoatworks Labs

Alleycat is electron-vite and React, with the house scaffolding copied from animATEM.

## Third-party code this project uses

Libraries, SDKs and frameworks the project is built on or bundles.

### Electron

<https://www.electronjs.org>  
Licence: MIT  
Copyright: OpenJS Foundation and Electron contributors

An npm dependency.

Ships one desktop app across macOS, Windows and Linux where the UI is the product and a bundled Chromium is an acceptable trade for that reach.

### React

<https://react.dev>  
Licence: MIT  
Copyright: Meta Platforms, Inc. and affiliates

An npm dependency.

The UI layer for the browser tools and the Electron and Tauri front ends.

### The npm ecosystem

<https://www.npmjs.com>  
Licence: predominantly MIT  
Copyright: the individual package authors

npm dependencies, resolved and pinned in the lockfile.

Build tooling, test runners and the libraries the front ends are assembled from. The exact set and versions for any build are in that repo's lockfile, which is the authoritative list.

The full transitive dependency set for any build is pinned in this repo's lockfile,
which is the authoritative list. What is named above is the layers a reader would
want to know about, not every package that has ever been resolved.

## Work we checked ourselves against

No code was taken from these — but they were how we knew we had it right, and that is worth saying out loud.

### Resolume Alley 7.27.1

Alley has no documented CLI. The five arguments Alleycat drives it with (--convertTest, --path, --preset, --width, --height) were found in the binary and verified against Alley 7.27.1 on macOS, along with the two behaviours src/main/services/alley.ts exists to absorb: Alley never exits, and its output lands beside the source under one of two naming rules. The conversion itself is Alley's; no DXV encoder is bundled.

### Resolume Arena 7.27.1 REST API and its shipped OpenAPI spec

src/main/services/arena.ts is read against the swagger.yaml Arena ships (the composition, the clip routes, and the description string whose second line is the codec, tested against the spec's own example) and was run end to end against Arena 7.27.1, which also returns video.fileinfo.format, a field the spec does not document. The by-index fallback is covered by unit tests only.

## Getting this wrong

If your work is here and the description is inaccurate, the licence is wrong, or you would rather not be listed — open an issue and it will be fixed.
