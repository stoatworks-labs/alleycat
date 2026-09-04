import { pathToFileURL } from 'node:url'
import type { ArenaClipRef } from '@shared/types'

/**
 * Client for the Arena / Avenue REST API.
 *
 * The webserver is off by default — it has to be enabled under Preferences >
 * Webserver — and the API is served under `/api/v1`.
 */

export class ArenaError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ArenaError'
  }
}

/** Raised for a 412, which means "not now" rather than "never". */
export class ClipLockedError extends ArenaError {
  constructor(message: string) {
    super(message, 412)
    this.name = 'ClipLockedError'
  }
}

/**
 * Raised for a 404 on a clip that was listed moments ago. Two distinct causes,
 * both observed on Arena 7.27.1, and both meaning "try again" rather than "fail":
 *
 *  1. **Clip ids are not stable.** Loading a file into a clip gives it a new id,
 *     and Arena also reassigns ids while it finishes opening a composition. An
 *     id read a moment ago can simply be gone.
 *  2. **`by-id` writes are refused for a while after Arena launches.** The
 *     composition reads fine and `GET .../by-id/{id}` returns 200, but
 *     `POST .../by-id/{id}/open` answers 404 until something has loaded a clip
 *     by some other route. `by-index` works during that window, which is what
 *     `openFileForClip` falls back to.
 */
export class StaleClipError extends ArenaError {
  constructor(message: string) {
    super(message, 404)
    this.name = 'StaleClipError'
  }
}

export interface ArenaClientOptions {
  host: string
  port: number
  timeoutMs?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

interface ChoiceParam {
  value?: string
  index?: number
}
interface StringParam {
  value?: string
}

interface RawClip {
  id: number
  name?: StringParam
  connected?: ChoiceParam
  video?: {
    description?: string
    fileinfo?: { path?: string; exists?: boolean; format?: string }
  } | null
}

interface RawLayer {
  id: number
  name?: StringParam
  clips?: RawClip[]
}

interface RawComposition {
  name?: StringParam
  layers?: RawLayer[]
}

/**
 * Whether a clip is currently playing.
 *
 * `connected` is a ChoiceParameter whose value is a display string. Matching
 * "connected" while excluding "disconnected" keeps this working if Resolume adds
 * another state, and errs toward "playing" — the safe direction, since the cost
 * of a false positive is a deferred swap and the cost of a false negative is
 * yanking a clip out of a live output.
 */
export function isClipPlaying(connected: ChoiceParam | undefined): boolean {
  const v = (connected?.value ?? '').toLowerCase()
  if (!v) return false
  if (v.includes('disconnect')) return false
  return v.includes('connect') || v.includes('preview')
}

/**
 * Read the codec out of Arena's human-readable description string.
 *
 * The spec's own example is:
 *   `Clip1.mov\nDXV 3.0 Normal Quality, With Alpha, 1920x1080, 23.98 Fps\r\n00:00:19.269`
 *
 * so the codec is the second line. This is a display string, not an API field,
 * and it is only ever used as a cheap hint for the show scan — anything that is
 * actually going to be converted gets its fourcc read from the file by
 * `probeFile` first.
 */
export function describedAsDxv(description: string | undefined): boolean {
  if (!description) return false
  const codecLine = description.split(/\r?\n/)[1] ?? description
  return /\bDXV\b/i.test(codecLine)
}

/**
 * The codec Arena reports for a clip.
 *
 * `fileinfo.format` is the better source — it is exactly the codec and nothing
 * else, e.g. `DXV 3.0 High Quality, No Alpha` or `AVF Lavc62.28.102 libx264`.
 * It is **not in the shipped OpenAPI spec**, which documents `VideoFileInfo` as
 * path/exists/duration/framerate/width/height only, but 7.27.1 returns it. The
 * description's second line is the documented fallback for when it is absent.
 */
export function codecOf(
  format: string | undefined,
  description: string | undefined
): { text: string; isDxv: boolean } {
  if (format) return { text: format, isDxv: /\bDXV\b/i.test(format) }
  const codecLine = (description ?? '').split(/\r?\n/)[1] ?? ''
  return { text: codecLine, isDxv: describedAsDxv(description) }
}

/** The minimum a caller must know to address a clip both ways. */
export interface ClipTarget {
  clipId: number
  layerIndex: number
  clipIndex: number
  /** The file the clip is expected to hold; guards the by-index fallback. */
  path: string
}

/** Case-insensitive where the filesystem is, matching the engine's own comparison. */
function samePathish(a: string, b: string): boolean {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

export class ArenaClient {
  private readonly base: string
  private readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(opts: ArenaClientOptions) {
    this.base = `http://${opts.host}:${opts.port}/api/v1`
    this.timeoutMs = opts.timeoutMs ?? 5000
    this.doFetch = opts.fetchImpl ?? fetch
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      return await this.doFetch(`${this.base}${path}`, { ...init, signal: ctl.signal })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new ArenaError(`cannot reach Arena at ${this.base}: ${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Product name, and the cheapest way to prove the webserver is actually on. */
  async product(): Promise<string> {
    const res = await this.request('/product')
    if (!res.ok) throw new ArenaError(`GET /product failed`, res.status)
    const body = (await res.json()) as { name?: string; major?: number; minor?: number }
    return [body.name, body.major && `${body.major}.${body.minor ?? 0}`].filter(Boolean).join(' ')
  }

  async composition(): Promise<RawComposition> {
    const res = await this.request('/composition')
    if (!res.ok) throw new ArenaError('GET /composition failed', res.status)
    return (await res.json()) as RawComposition
  }

  /**
   * Every clip in the composition that holds a file, flattened, with the codec
   * verdict Arena's own description implies.
   */
  async listFileClips(): Promise<ArenaClipRef[]> {
    const comp = await this.composition()
    const out: ArenaClipRef[] = []

    const layers = comp.layers ?? []
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]
      const layerName = layer.name?.value ?? `Layer ${layer.id}`
      const clips = layer.clips ?? []
      for (let ci = 0; ci < clips.length; ci++) {
        const clip = clips[ci]
        const path = clip.video?.fileinfo?.path
        if (!path) continue // empty slot, or a generator source rather than a file
        const description = clip.video?.description ?? ''
        const codec = codecOf(clip.video?.fileinfo?.format, description)
        out.push({
          clipId: clip.id,
          layerIndex: li + 1,
          clipIndex: ci + 1,
          layerName,
          clipName: clip.name?.value ?? `Clip ${clip.id}`,
          path,
          exists: clip.video?.fileinfo?.exists !== false,
          description,
          codec: codec.text,
          isDxv: codec.isDxv,
          connected: isClipPlaying(clip.connected)
        })
      }
    }
    return out
  }

  /** The file a clip currently holds, or null. Used to confirm a by-index target. */
  private async pathAtIndex(layerIndex: number, clipIndex: number): Promise<string | null> {
    const res = await this.request(`/composition/layers/${layerIndex}/clips/${clipIndex}`)
    if (!res.ok) return null
    const clip = (await res.json()) as RawClip
    return clip.video?.fileinfo?.path ?? null
  }

  /**
   * Point a clip at a different file, falling back to by-index addressing.
   *
   * `by-id` `/open` returns 404 for a while after Arena launches — the
   * composition reads fine and `GET .../by-id/{id}` returns 200, but the write
   * is refused until something has loaded a clip. `by-index` works during that
   * window.
   *
   * The fallback is dangerous on its own: indices address the **selected deck**,
   * so if the deck changed since the composition was listed, the same indices
   * point at a different clip and the file would land in the wrong slot — in a
   * live show. It therefore re-reads the clip at those indices and only writes
   * if it still holds the file being replaced.
   */
  async openFileForClip(ref: ClipTarget, filePath: string): Promise<void> {
    try {
      await this.openFileInClip(ref.clipId, filePath)
      return
    } catch (err) {
      if (!(err instanceof StaleClipError)) throw err
    }

    const current = await this.pathAtIndex(ref.layerIndex, ref.clipIndex)
    if (current === null || !samePathish(current, ref.path)) {
      throw new StaleClipError(
        `clip ${ref.clipId} not addressable by id, and layer ${ref.layerIndex}/clip ` +
          `${ref.clipIndex} no longer holds ${ref.path}`
      )
    }

    const url = pathToFileURL(filePath).href
    const res = await this.request(
      `/composition/layers/${ref.layerIndex}/clips/${ref.clipIndex}/open`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url }
    )
    if (res.status === 204 || res.ok) return
    if (res.status === 412) {
      throw new ClipLockedError((await res.text().catch(() => '')) || 'the clip cannot be changed')
    }
    throw new StaleClipError(`clip ${ref.clipId} could not be opened by id or by index`)
  }

  /**
   * Point a clip at a different file.
   *
   * Uses `/open` rather than `/openfile`; the latter is marked deprecated in the
   * shipped spec. Settings are retained "as much as possible", so in/out points
   * and clip effects survive the swap.
   */
  async openFileInClip(clipId: number, filePath: string): Promise<void> {
    const url = pathToFileURL(filePath).href
    const res = await this.request(`/composition/clips/by-id/${clipId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: url
    })

    if (res.status === 204 || res.ok) return

    if (res.status === 412) {
      const detail = await res.text().catch(() => '')
      throw new ClipLockedError(detail || 'the clip cannot be changed currently')
    }
    if (res.status === 404) {
      throw new StaleClipError(`clip ${clipId} no longer exists`)
    }
    throw new ArenaError(`open failed for clip ${clipId}`, res.status)
  }
}
