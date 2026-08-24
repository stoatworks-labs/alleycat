import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeFile, isDxvTag, isHapTag, isVideoPath } from '../services/probe'

function have(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('tag classification', () => {
  it('matches the DXV family by prefix', () => {
    expect(isDxvTag('DXD3')).toBe(true)
    expect(isDxvTag('DXDI')).toBe(true)
    expect(isDxvTag('DXDA')).toBe(true)
    expect(isDxvTag('avc1')).toBe(false)
    expect(isDxvTag('Hap1')).toBe(false)
  })

  it('recognises Hap separately', () => {
    expect(isHapTag('HapY')).toBe(true)
    expect(isHapTag('DXD3')).toBe(false)
  })

  it('only treats known video extensions as footage', () => {
    expect(isVideoPath('/x/a.mov')).toBe(true)
    expect(isVideoPath('/x/a.MP4')).toBe(true)
    expect(isVideoPath('/x/a.png')).toBe(false)
    expect(isVideoPath('/x/a.wav')).toBe(false)
  })
})

describe('probeFile', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'alleycat-probe-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reports non-video files without opening them', async () => {
    const p = join(dir, 'notes.txt')
    writeFileSync(p, 'hello')
    const r = await probeFile(p)
    expect(r.isVideo).toBe(false)
    expect(r.isDxv).toBe(false)
  })

  it('treats a non-QuickTime container as not-DXV without parsing', async () => {
    // DXV only ever lives in a QuickTime container, so an .mp4 is decided by
    // extension alone and never opened.
    const p = join(dir, 'clip.mp4')
    writeFileSync(p, 'not really an mp4')
    const r = await probeFile(p)
    expect(r.isVideo).toBe(true)
    expect(r.isDxv).toBe(false)
    expect(r.fourcc).toBeNull()
  })

  it('does not throw on a truncated .mov', async () => {
    const p = join(dir, 'broken.mov')
    writeFileSync(p, Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70]))
    const r = await probeFile(p)
    expect(r.isDxv).toBe(false)
    expect(r.error).toBeDefined()
  })

  it.runIf(have('ffmpeg'))('reads the fourcc of a real ProRes .mov', async () => {
    const p = join(dir, 'prores.mov')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=10:duration=1',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '0',
      p
    ])
    const r = await probeFile(p)
    expect(r.fourcc).toBe('apco')
    expect(r.isDxv).toBe(false)
  })

  it.runIf(have('ffmpeg'))('skips a leading audio track to find the video fourcc', async () => {
    const p = join(dir, 'av.mov')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=10:duration=1',
      '-c:a',
      'pcm_s16le',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '0',
      p
    ])
    const r = await probeFile(p)
    expect(r.fourcc).toBe('apco')
  })
})
