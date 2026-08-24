import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'

/**
 * Alley conversion presets, discovered rather than hardcoded.
 *
 * Two locations, both verified on Alley 7.27.1:
 *  - the stock eleven, inside the install at `<Alley>/default/Presets`
 *  - anything the user saved, in `~/Documents/Resolume Alley/Presets`
 *
 * A user preset with the same name as a stock one wins, which is what Alley
 * itself does when resolving `--preset`.
 */

export function stockPresetDir(alleyPath: string): string | null {
  if (!alleyPath) return null
  // macOS: <root>/Alley.app/Contents/MacOS/Alley -> <root>/default/Presets
  const macRoot = alleyPath.split('/Alley.app/')[0]
  if (macRoot !== alleyPath) return join(macRoot, 'default', 'Presets')
  // Windows/Linux: alongside the executable.
  return join(dirname(alleyPath), 'default', 'Presets')
}

export function userPresetDir(home: string = homedir()): string {
  return join(home, 'Documents', 'Resolume Alley', 'Presets')
}

async function namesIn(dir: string | null): Promise<string[]> {
  if (!dir) return []
  try {
    const entries = await readdir(dir)
    return entries.filter((f) => f.endsWith('.xml')).map((f) => basename(f, '.xml'))
  } catch {
    return []
  }
}

export async function listPresets(alleyPath: string, home?: string): Promise<string[]> {
  const [stock, user] = await Promise.all([
    namesIn(stockPresetDir(alleyPath)),
    namesIn(userPresetDir(home))
  ])
  return [...new Set([...stock, ...user])].sort((a, b) => a.localeCompare(b))
}
