#!/usr/bin/env node
/**
 * Asserts that the preload script the built main process actually asks for
 * exists on disk.
 *
 * v0.1.0-preview.1 shipped with a blank window: `"type": "module"` in
 * package.json made electron-vite emit the preload as `index.mjs` while main
 * still asked for `index.js`. The preload silently failed to load, so
 * `window.alleycat` was undefined and the renderer died on first use. Nothing
 * caught it — typecheck, lint and the unit tests all pass, because the mismatch
 * only exists between two build outputs.
 *
 * Reads the string out of the *built* main bundle rather than the source, so it
 * checks what will really run.
 *
 * Run: node scripts/check-bundle.mjs   (after `npm run build`)
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainBundle = join(root, 'out', 'main', 'index.js')

if (!existsSync(mainBundle)) {
  console.error(`check-bundle: ${mainBundle} missing — run "npm run build" first`)
  process.exit(1)
}

const src = readFileSync(mainBundle, 'utf8')
const matches = [...src.matchAll(/["'`](\.\.\/preload\/[A-Za-z0-9._-]+)["'`]/g)].map((m) => m[1])

if (matches.length === 0) {
  console.error('check-bundle: the built main bundle references no preload script at all')
  process.exit(1)
}

let bad = 0
for (const rel of new Set(matches)) {
  const abs = resolve(join(root, 'out', 'main'), rel)
  if (existsSync(abs)) {
    console.log(`preload ok: ${rel}`)
  } else {
    console.error(`check-bundle: main references ${rel}, which does not exist (${abs})`)
    bad++
  }
}
process.exit(bad === 0 ? 0 : 1)
