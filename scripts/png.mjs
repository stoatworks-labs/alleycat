/**
 * Minimal RGBA PNG encoder plus the coverage samplers the icon generators use.
 * Shared by make-tray-icon.mjs and make-app-icon.mjs so the two icons are drawn
 * by the same code and cannot drift into different-looking cats.
 */
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeInt32BE(crc32(body))
  return Buffer.concat([len, body, crcBuf])
}

/** Encode a size x size RGBA Uint8Array as a PNG buffer. */
export function encodePng(px, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const SS = 4 // supersampling grid per axis

/** Coverage of a disc at a pixel, sampled SSxSS. */
export function disc(x, y, cx, cy, r) {
  let hits = 0
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS
      const py = y + (sy + 0.5) / SS
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++
    }
  }
  return hits / (SS * SS)
}

/** Coverage of a triangle, same sampling. */
export function tri(x, y, ax, ay, bx, by, cx, cy) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry)
  let hits = 0
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS
      const py = y + (sy + 0.5) / SS
      const d1 = sign(px, py, ax, ay, bx, by)
      const d2 = sign(px, py, bx, by, cx, cy)
      const d3 = sign(px, py, cx, cy, ax, ay)
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) hits++
    }
  }
  return hits / (SS * SS)
}

/** Coverage of a rounded rectangle (the macOS icon shape). */
export function roundRect(x, y, left, top, right, bottom, radius) {
  let hits = 0
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS
      const py = y + (sy + 0.5) / SS
      if (px < left || px > right || py < top || py > bottom) continue
      const qx = Math.max(left + radius - px, px - (right - radius), 0)
      const qy = Math.max(top + radius - py, py - (bottom - radius), 0)
      if (qx * qx + qy * qy <= radius * radius) hits++
    }
  }
  return hits / (SS * SS)
}

/** The Alleycat mark: a cat head with ears and two punched-out eyes, in a 32-unit box. */
export function catCoverage(x, y, s) {
  const u = (v) => v * (s / 32)
  let a = disc(x, y, u(16), u(19), u(10.5))
  a = Math.max(a, tri(x, y, u(6.5), u(13), u(9), u(3), u(14.5), u(10)))
  a = Math.max(a, tri(x, y, u(25.5), u(13), u(23), u(3), u(17.5), u(10)))
  a *= 1 - disc(x, y, u(12), u(18), u(2.1))
  a *= 1 - disc(x, y, u(20), u(18), u(2.1))
  return Math.max(0, Math.min(1, a))
}

/**
 * Identity of an icon, taken from its raw RGBA pixels.
 *
 * Deliberately not a hash of the PNG file: zlib's deflate output differs between
 * versions, so the same drawing encodes to a different number of bytes on
 * different machines (281 locally, 283 on the CI runner). Hashing the pixels
 * checks the artwork, which is the thing that must not drift, and ignores the
 * compressor's mood.
 */
export function pixelHash(px) {
  return createHash('sha256')
    .update(Buffer.from(px.buffer, px.byteOffset, px.length))
    .digest('hex')
}

const manifestPath = (root) => join(root, 'build', 'icons.sha256')

function readManifest(root) {
  const p = manifestPath(root)
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
  )
}

export function recordHash(root, key, hash) {
  const m = readManifest(root)
  m[key] = hash
  const body =
    Object.keys(m)
      .sort()
      .map((k) => `${k} ${m[k]}`)
      .join('\n') + '\n'
  writeFileSync(manifestPath(root), body)
}

/** Exits non-zero if the drawing no longer matches what was committed. */
export function checkHash(root, key, hash) {
  const expected = readManifest(root)[key]
  if (expected === hash) {
    console.log(`${key}: ok (${hash.slice(0, 12)})`)
    return
  }
  console.error(`${key}: MISMATCH\n  committed: ${expected ?? '(absent)'}\n  generated: ${hash}`)
  process.exit(1)
}
