import { access, open, constants, type FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * Codec detection, done by reading the container rather than by asking Arena.
 *
 * Arena's REST API deliberately does not expose a codec: `VideoFileInfo` is
 * path/exists/duration/framerate/width/height and nothing else. The only codec
 * signal it offers is `video.description`, a human-readable display string. That
 * is fine as a hint for the live scan but it is not something to transcode on,
 * so before Alleycat spends minutes converting a file it reads the fourcc out of
 * the file itself.
 */

/** Extensions that could conceivably hold DXV. Everything else is decided by extension alone. */
const CONTAINER_EXTS = new Set(['.mov', '.qt'])

/** Extensions Alleycat considers convertible footage at all. */
const VIDEO_EXTS = new Set([
  '.mov',
  '.qt',
  '.mp4',
  '.m4v',
  '.avi',
  '.mkv',
  '.mxf',
  '.webm',
  '.mpg',
  '.mpeg',
  '.m2v',
  '.wmv',
  '.flv',
  '.prores'
])

/** Hap is already a GPU-friendly block-compressed codec, reported separately from "some h264 file". */
const HAP_TAGS = new Set(['Hap1', 'Hap5', 'HapY', 'HapM', 'HapA'])

export interface ProbeResult {
  path: string
  /** The video fourcc as found in the container, if one could be read. */
  fourcc: string | null
  isDxv: boolean
  /** True for Hap, which is GPU-ready but is not DXV. */
  isHap: boolean
  /** False for stills, audio, sidecars and anything else not worth queueing. */
  isVideo: boolean
  /** Set when the file could not be parsed, rather than throwing. */
  error?: string
}

/**
 * DXV is written with a `DXD*` fourcc — `DXD3` for DXV3, `DXDI` for the older
 * one. Matching the prefix rather than an enumerated list means a future DXV
 * revision is not silently treated as footage that needs converting.
 */
export function isDxvTag(tag: string): boolean {
  return tag.startsWith('DXD')
}

export function isHapTag(tag: string): boolean {
  return HAP_TAGS.has(tag)
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXTS.has(extname(path).toLowerCase())
}

/**
 * Walk the QuickTime atom tree to `moov/trak/mdia/minf/stbl/stsd` and return the
 * first video sample-description fourcc.
 *
 * Only atom headers are read, so this costs a handful of small reads even on a
 * 40GB file; `stsd` itself is small enough to read whole.
 */
async function readMovFourcc(fh: FileHandle, fileSize: number): Promise<string | null> {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
  const header = Buffer.alloc(16)

  const walk = async (start: number, end: number, depth: number): Promise<string | null> => {
    // A malformed file must not become an unbounded recursion.
    if (depth > 8) return null
    let offset = start

    while (offset + 8 <= end) {
      const { bytesRead } = await fh.read(header, 0, 16, offset)
      if (bytesRead < 8) return null

      let size = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      let headerSize = 8

      if (size === 1) {
        // 64-bit extended size lives in the 8 bytes after the type.
        if (bytesRead < 16) return null
        const hi = header.readUInt32BE(8)
        const lo = header.readUInt32BE(12)
        size = hi * 2 ** 32 + lo
        headerSize = 16
      } else if (size === 0) {
        // "Extends to end of file" — legal for the last atom.
        size = end - offset
      }

      if (size < headerSize || offset + size > end) return null

      if (type === 'stsd') {
        // 4 version/flags + 4 entry count, then entries of 4 size + 4 format.
        const body = Buffer.alloc(Math.min(size - headerSize, 4096))
        await fh.read(body, 0, body.length, offset + headerSize)
        if (body.length < 16) return null
        const entries = body.readUInt32BE(4)
        if (entries === 0) return null
        return body.toString('latin1', 12, 16)
      }

      if (CONTAINERS.has(type)) {
        const found = await walk(offset + headerSize, offset + size, depth + 1)
        // A file can hold an audio trak before the video one; keep looking.
        if (found && found.trim() !== '' && !isAudioLikeTag(found)) return found
      }

      offset += size
    }
    return null
  }

  return walk(0, fileSize, 0)
}

/** Sample descriptions in an audio trak carry audio fourccs; skip past them. */
function isAudioLikeTag(tag: string): boolean {
  return ['mp4a', 'sowt', 'twos', 'lpcm', 'in24', 'in32', 'fl32', 'fl64', '.mp3'].includes(tag)
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    path,
    fourcc: null,
    isDxv: false,
    isHap: false,
    isVideo: isVideoPath(path)
  }

  if (!base.isVideo) return base

  // Does the file exist and can it be read? Ask before deciding anything else.
  //
  // This used to be skipped entirely for a non-QuickTime container: a missing
  // .mp4 was never opened, so it came back isVideo:true with no error, reached
  // convert(), and Alley was spawned on a path with nothing at it. Alley never
  // exits, so the job then sat there for the full 10-minute stall timeout with
  // every other conversion queued behind it — and the next scan tick, 20 s
  // later, made a fresh job and did it again.
  try {
    await access(path, constants.R_OK)
  } catch (err) {
    return {
      ...base,
      error:
        err instanceof Error && 'code' in err && err.code === 'ENOENT'
          ? 'file not found'
          : `file is not readable: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // Only QuickTime containers can hold DXV, so anything else is known to need
  // converting without opening it at all.
  if (!CONTAINER_EXTS.has(extname(path).toLowerCase())) return base

  let fh: FileHandle | undefined
  try {
    fh = await open(path, 'r')
    const { size } = await fh.stat()
    const fourcc = await readMovFourcc(fh, size)
    if (!fourcc) return { ...base, error: 'no video sample description found' }
    return {
      ...base,
      fourcc,
      isDxv: isDxvTag(fourcc),
      isHap: isHapTag(fourcc)
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await fh?.close()
  }
}
