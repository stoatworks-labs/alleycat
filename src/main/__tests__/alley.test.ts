import { describe, it, expect } from 'vitest'
import { predictOutputPath, defaultAlleyPath, verifyAlley } from '../services/alley'

describe('predictOutputPath', () => {
  it('swaps the extension for a non-mov source', () => {
    expect(predictOutputPath('/media/in.mp4', 'DXV High Quality No Alpha')).toBe('/media/in.mov')
  })

  it('appends the preset when the source is already a .mov', () => {
    // Verified against Alley 7.27.1: c.mov became
    // "c_DXV High Quality With Alpha.mov" rather than overwriting its source.
    expect(predictOutputPath('/media/c.mov', 'DXV High Quality With Alpha')).toBe(
      '/media/c_DXV High Quality With Alpha.mov'
    )
  })

  it('is case-insensitive about the source extension', () => {
    expect(predictOutputPath('/media/C.MOV', 'P')).toBe('/media/C_P.mov')
  })
})

describe('defaultAlleyPath', () => {
  it('points inside the bundle on macOS', () => {
    expect(defaultAlleyPath('darwin')).toContain('Alley.app/Contents/MacOS/Alley')
  })
  it('points at the exe on Windows', () => {
    expect(defaultAlleyPath('win32')).toMatch(/Alley\.exe$/)
  })
})

describe('verifyAlley', () => {
  it('rejects an empty path', () => {
    expect(verifyAlley('').ok).toBe(false)
  })
  it('rejects a path that does not exist', () => {
    expect(verifyAlley('/nope/Alley').ok).toBe(false)
  })
})
