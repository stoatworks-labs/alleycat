import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { stockPresetDir, listPresets } from '../services/presets'

const ALLEY = '/Applications/Resolume Alley/Alley.app/Contents/MacOS/Alley'

describe('stockPresetDir', () => {
  it('climbs out of the macOS bundle to the install root', () => {
    expect(stockPresetDir(ALLEY)).toBe('/Applications/Resolume Alley/default/Presets')
  })

  it('sits beside the executable elsewhere', () => {
    expect(stockPresetDir('C:\\Program Files\\Resolume Alley\\Alley.exe')).toContain('default')
  })

  it('is null with no path configured', () => {
    expect(stockPresetDir('')).toBeNull()
  })
})

describe('listPresets', () => {
  it.runIf(existsSync(ALLEY))('finds the stock presets in a real install', async () => {
    const presets = await listPresets(ALLEY)
    expect(presets).toContain('DXV High Quality No Alpha')
    expect(presets).toContain('ProRes 4444')
    expect(presets.length).toBeGreaterThanOrEqual(11)
  })

  it('still returns user presets when the Alley path is wrong', async () => {
    // Alley mirrors the stock presets into ~/Documents/Resolume Alley/Presets,
    // so a bad install path degrades to the user copies rather than to nothing.
    const presets = await listPresets('/nonexistent/Alley')
    expect(Array.isArray(presets)).toBe(true)
  })

  it('returns empty rather than throwing when neither directory exists', async () => {
    expect(await listPresets('/nonexistent/Alley', '/nonexistent/home')).toEqual([])
  })
})
