import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Driver for Resolume Alley's command line.
 *
 * Alley has no documented CLI. It does accept five arguments, found in the
 * binary and verified against Alley 7.27.1 on macOS:
 *
 *   --convertTest  --path <file|folder>  --preset <name>  [--width N --height N]
 *
 * Three behaviours matter and none of them are obvious:
 *
 *  1. **Alley never exits.** It converts and then sits there as a GUI app. There
 *     is no exit code to wait on, so completion has to be detected from the
 *     output file and the process killed afterwards.
 *  2. **Output lands beside the source**, named after it. If that would collide
 *     with the source (i.e. the source is itself a .mov) Alley appends the
 *     preset name instead.
 *  3. **`--convertTest` reads as an internal test hook**, not a supported entry
 *     point, so it can change between releases. `verifyAlley()` exists to fail
 *     loudly rather than silently converting nothing.
 */

export interface ConvertOptions {
  alleyPath: string
  sourcePath: string
  preset: string
  width?: number | null
  height?: number | null
  /** Give up if no output has appeared this long after the last sign of progress. */
  stallTimeoutMs?: number
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

/** How long the output size must hold steady before it counts as finished. */
const SETTLE_MS = 2500
const POLL_MS = 500
const DEFAULT_STALL_TIMEOUT_MS = 10 * 60 * 1000

export function defaultAlleyPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return '/Applications/Resolume Alley/Alley.app/Contents/MacOS/Alley'
  }
  if (platform === 'win32') {
    return 'C:\\Program Files\\Resolume Alley\\Alley.exe'
  }
  return 'Alley'
}

/**
 * Where Alley will put the converted file.
 *
 * Verified: `in.mp4` -> `in.mov`, and `c.mov` -> `c_DXV High Quality With Alpha.mov`,
 * because Alley refuses to overwrite its own source.
 */
export function predictOutputPath(sourcePath: string, preset: string): string {
  const dir = dirname(sourcePath)
  const ext = extname(sourcePath)
  const base = basename(sourcePath, ext)
  if (ext.toLowerCase() === '.mov') {
    return join(dir, `${base}_${preset}.mov`)
  }
  return join(dir, `${base}.mov`)
}

export function verifyAlley(alleyPath: string): { ok: boolean; reason?: string } {
  if (!alleyPath) return { ok: false, reason: 'no Alley path configured' }
  if (!existsSync(alleyPath)) return { ok: false, reason: `not found: ${alleyPath}` }
  return { ok: true }
}

async function statOrNull(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Convert one file and resolve with the path Alley wrote.
 *
 * Always kills the Alley process before resolving or rejecting — leaking one per
 * job would leave a stack of invisible GUI apps holding the GPU.
 */
export async function convert(opts: ConvertOptions): Promise<string> {
  const {
    alleyPath,
    sourcePath,
    preset,
    width,
    height,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    signal,
    onProgress
  } = opts

  const check = verifyAlley(alleyPath)
  if (!check.ok) throw new Error(check.reason)

  const outputPath = predictOutputPath(sourcePath, preset)
  // Remember what was there first, so an existing file from an earlier run is
  // not mistaken for this run's output.
  const before = await statOrNull(outputPath)

  const args = ['--convertTest', '--path', sourcePath, '--preset', preset]
  if (width && height) args.push('--width', String(width), '--height', String(height))

  const child: ChildProcess = spawn(alleyPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let exited = false
  let exitInfo = ''
  child.on('exit', (code, sig) => {
    exited = true
    exitInfo = `code=${code} signal=${sig}`
  })

  const kill = (): void => {
    if (!child.killed && child.pid) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }

  try {
    let lastChange = Date.now()
    let steadySince: number | null = null
    let lastSize = -1

    for (;;) {
      if (signal?.aborted) throw new Error('cancelled')

      const now = await statOrNull(outputPath)
      const isOurs =
        now !== null &&
        (before === null || now.mtimeMs > before.mtimeMs || now.size !== before.size)

      if (isOurs) {
        if (now.size !== lastSize) {
          lastSize = now.size
          lastChange = Date.now()
          steadySince = null
          onProgress?.(`writing ${(now.size / 1e6).toFixed(1)} MB`)
        } else if (now.size > 0) {
          steadySince ??= Date.now()
          if (Date.now() - steadySince >= SETTLE_MS) return outputPath
        }
      }

      // Alley dying before it produced anything is a real failure; dying after
      // is not, because we are the ones who kill it.
      if (exited && !isOurs) {
        throw new Error(`Alley exited before producing output (${exitInfo})`)
      }

      if (Date.now() - lastChange > stallTimeoutMs) {
        throw new Error(`timed out after ${Math.round(stallTimeoutMs / 1000)}s with no progress`)
      }

      await delay(POLL_MS)
    }
  } finally {
    kill()
  }
}
