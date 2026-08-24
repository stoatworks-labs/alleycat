import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convert, predictOutputPath } from '../services/alley'
import { probeFile } from '../services/probe'

/**
 * End-to-end against the real Alley. Opt-in, because it drives a GPU app and
 * takes tens of seconds:
 *
 *   ALLEYCAT_HW=1 npm test
 */
const ALLEY = '/Applications/Resolume Alley/Alley.app/Contents/MacOS/Alley'
const enabled = process.env.ALLEYCAT_HW === '1' && existsSync(ALLEY)

describe.runIf(enabled)('Alley end to end', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'alleycat-hw-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('converts an h264 source to a file the probe reports as DXV', async () => {
    const src = join(dir, 'in.mp4')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25:duration=2',
      '-pix_fmt',
      'yuv420p',
      src
    ])

    const before = await probeFile(src)
    expect(before.isDxv).toBe(false)

    const out = await convert({
      alleyPath: ALLEY,
      sourcePath: src,
      preset: 'DXV High Quality No Alpha'
    })

    expect(out).toBe(predictOutputPath(src, 'DXV High Quality No Alpha'))
    const after = await probeFile(out)
    expect(after.fourcc).toBe('DXD3')
    expect(after.isDxv).toBe(true)
  }, 120_000)

  it('honours the size override and the mov naming rule', async () => {
    const src = join(dir, 'sized.mov')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25:duration=1',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '0',
      src
    ])

    const out = await convert({
      alleyPath: ALLEY,
      sourcePath: src,
      preset: 'DXV High Quality No Alpha',
      width: 1280,
      height: 720
    })

    // Source was already a .mov, so Alley appends the preset name.
    expect(out).toContain('sized_DXV High Quality No Alpha.mov')
    const after = await probeFile(out)
    expect(after.isDxv).toBe(true)
  }, 120_000)
})
