import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DEFAULT_CONFIG, type Config } from '@shared/types'
import { defaultAlleyPath } from './alley'

/** Config lives as plain JSON in userData so it can be hand-edited when something goes wrong at a show. */

let cached: Config | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/**
 * Merge one level deep so a config file written by an older version does not
 * lose new keys, and a partially hand-edited file still boots.
 */
function merge(base: Config, patch: Partial<Config>): Config {
  return {
    ...base,
    ...patch,
    arena: { ...base.arena, ...(patch.arena ?? {}) }
  }
}

export function loadConfig(): Config {
  if (cached) return cached
  const defaults: Config = { ...DEFAULT_CONFIG, alleyPath: defaultAlleyPath() }
  const path = configPath()

  if (!existsSync(path)) {
    cached = defaults
    return cached
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>
    cached = merge(defaults, raw)
  } catch {
    // A corrupt config must not stop the app booting; defaults are recoverable.
    cached = defaults
  }
  return cached
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = merge(loadConfig(), patch)
  cached = next
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  return next
}
