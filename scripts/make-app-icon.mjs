#!/usr/bin/env node
/**
 * Generates build/icon.png (1024x1024), from which electron-builder derives the
 * .icns and .ico. Without it the release ships the default Electron icon.
 *
 * Run: node scripts/make-app-icon.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { encodePng, roundRect, catCoverage, pixelHash, recordHash, checkHash } from './png.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = 1024

// macOS expects the icon to carry its own rounded shape with a little margin,
// rather than a full-bleed square that the OS will not mask for you.
const M = Math.round(S * 0.08)
const R = Math.round(S * 0.22)

// Dark panel with the UI's amber accent, so the icon and the app agree.
const BG_TOP = [0x2a, 0x2d, 0x36]
const BG_BOT = [0x1b, 0x1d, 0x23]
const CAT = [0xff, 0xb3, 0x47]

const px = new Uint8Array(S * S * 4)
const catBox = Math.round(S * 0.62)
const catOff = Math.round((S - catBox) / 2)

for (let y = 0; y < S; y++) {
  const t = y / (S - 1)
  const bg = [0, 1, 2].map((i) => Math.round(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t))
  for (let x = 0; x < S; x++) {
    const plate = roundRect(x, y, M, M, S - M, S - M, R)
    if (plate <= 0) continue

    const cat = catCoverage(x - catOff, y - catOff - Math.round(S * 0.02), catBox)
    const i = (y * S + x) * 4
    for (let c = 0; c < 3; c++) {
      px[i + c] = Math.round(bg[c] + (CAT[c] - bg[c]) * cat)
    }
    px[i + 3] = Math.round(plate * 255)
  }
}

const hash = pixelHash(px)
if (process.argv.includes('--check')) {
  checkHash(root, 'app', hash)
} else {
  writeFileSync(join(root, 'build', 'icon.png'), encodePng(px, S))
  recordHash(root, 'app', hash)
  console.log(`wrote build/icon.png (${S}x${S})`)
}
