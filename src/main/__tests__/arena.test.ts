import { describe, it, expect, vi } from 'vitest'
import type { ArenaClipRef } from '../../shared/types'
import {
  ArenaClient,
  ClipLockedError,
  StaleClipError,
  codecOf,
  describedAsDxv,
  isClipPlaying
} from '../services/arena'

describe('describedAsDxv', () => {
  it('reads the codec from the second line, as Arena writes it', () => {
    // The exact shape from the shipped OpenAPI spec's own example.
    const d = 'Clip1.mov\nDXV 3.0 Normal Quality, With Alpha, 1920x1080, 23.98 Fps\r\n00:00:19.269'
    expect(describedAsDxv(d)).toBe(true)
  })

  it('is false for h264', () => {
    expect(describedAsDxv('bad.mp4\nH.264, 1920x1080, 25 Fps\r\n00:00:10.000')).toBe(false)
  })

  it('does not match a filename that merely contains DXV', () => {
    // The filename is line one; only the codec line is consulted, so a file
    // called "dxv-masters.mp4" holding h264 is still reported as needing work.
    expect(describedAsDxv('dxv-masters.mp4\nH.264, 1920x1080, 25 Fps')).toBe(false)
  })

  it('is false for an empty description', () => {
    expect(describedAsDxv(undefined)).toBe(false)
    expect(describedAsDxv('')).toBe(false)
  })
})

describe('isClipPlaying', () => {
  it('treats Connected as playing', () => {
    expect(isClipPlaying({ value: 'Connected' })).toBe(true)
  })
  it('treats Disconnected as not playing, despite the substring', () => {
    expect(isClipPlaying({ value: 'Disconnected' })).toBe(false)
  })
  it('treats Previewing as playing, erring toward not touching it', () => {
    expect(isClipPlaying({ value: 'Previewing' })).toBe(true)
  })
  it('is false when absent', () => {
    expect(isClipPlaying(undefined)).toBe(false)
  })
})

function clientWith(fetchImpl: typeof fetch): ArenaClient {
  return new ArenaClient({ host: '127.0.0.1', port: 8080, fetchImpl })
}

describe('listFileClips', () => {
  it('flattens layers and skips clips with no file', async () => {
    const composition = {
      layers: [
        {
          id: 1,
          name: { value: 'Layer 1' },
          clips: [
            {
              id: 100,
              name: { value: 'Good' },
              connected: { value: 'Disconnected' },
              video: {
                description: 'a.mov\nDXV 3.0 High Quality, 1920x1080, 25 Fps',
                fileinfo: { path: '/m/a.mov' }
              }
            },
            {
              id: 101,
              name: { value: 'Bad' },
              connected: { value: 'Connected' },
              video: {
                description: 'b.mp4\nH.264, 1920x1080, 25 Fps',
                fileinfo: { path: '/m/b.mp4' }
              }
            },
            { id: 102, name: { value: 'Empty' }, video: null }
          ]
        }
      ]
    }
    const c = clientWith(
      vi.fn(async () => new Response(JSON.stringify(composition), { status: 200 })) as never
    )
    const clips = await c.listFileClips()
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ clipId: 100, isDxv: true, connected: false })
    // 1-based, for the by-index fallback
    expect(clips[0]).toMatchObject({ layerIndex: 1, clipIndex: 1 })
    expect(clips[1]).toMatchObject({ layerIndex: 1, clipIndex: 2 })
    expect(clips[0].codec).toContain('DXV')
    expect(clips[1]).toMatchObject({ clipId: 101, isDxv: false, connected: true })
  })
})

describe('openFileInClip', () => {
  it('posts a percent-encoded file URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const c = clientWith(fetchImpl as never)
    await c.openFileInClip(42, '/media/My Show/clip 1.mov')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/api/v1/composition/clips/by-id/42/open')
    expect(init.method).toBe('POST')
    // Spaces must be encoded or Arena will not find the file.
    expect(init.body).toBe('file:///media/My%20Show/clip%201.mov')
  })

  it('raises ClipLockedError on 412 so the swap can be retried later', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('the clip cannot be changed currently', { status: 412 })
    )
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileInClip(1, '/m/a.mov')).rejects.toBeInstanceOf(ClipLockedError)
  })

  it('raises StaleClipError on 404, because ids are reassigned on load', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileInClip(1, '/m/a.mov')).rejects.toBeInstanceOf(StaleClipError)
  })

  it('raises a plain error on anything else', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileInClip(1, '/m/a.mov')).rejects.toThrow(/open failed/)
  })
})

describe('codecOf', () => {
  it('prefers the undocumented fileinfo.format field', () => {
    // Real values from Arena 7.27.1.
    expect(codecOf('DXV 3.0 High Quality, No Alpha', undefined)).toEqual({
      text: 'DXV 3.0 High Quality, No Alpha',
      isDxv: true
    })
    expect(codecOf('AVF Lavc62.28.102 libx264', undefined).isDxv).toBe(false)
  })

  it('falls back to the description when format is absent', () => {
    const d = 'h264-source.mov\nDXV 3.0 High Quality, No Alpha, 640x360, 25.00 Fps\n00:00:03.000'
    expect(codecOf(undefined, d)).toEqual({
      text: 'DXV 3.0 High Quality, No Alpha, 640x360, 25.00 Fps',
      isDxv: true
    })
  })

  it('handles a clip with neither', () => {
    expect(codecOf(undefined, undefined)).toEqual({ text: '', isDxv: false })
  })
})

describe('all five connected states from Arena 7.27.1', () => {
  // The real options list, read from a live composition.
  it.each([
    ['Empty', false],
    ['Disconnected', false],
    ['Previewing', true],
    ['Connected', true],
    ['Connected & previewing', true]
  ])('%s -> playing=%s', (value, expected) => {
    expect(isClipPlaying({ value })).toBe(expected)
  })
})

describe('openFileForClip — by-index fallback', () => {
  const ref = { clipId: 7, layerIndex: 2, clipIndex: 3, path: '/m/old.mp4' }
  // vi.fn() infers a zero-arg signature, so the recorded calls need widening.
  const calls = (f: { mock: { calls: unknown[] } }): Array<[string, RequestInit]> =>
    f.mock.calls as Array<[string, RequestInit]>

  it('uses by-id when it works, and never touches the index route', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const c = clientWith(fetchImpl as never)
    await c.openFileForClip(ref, '/m/new.mov')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(calls(fetchImpl)[0][0]).toContain('/clips/by-id/7/open')
  })

  it('falls back to by-index when by-id 404s, once the target is confirmed', async () => {
    // by-id open 404s (the cold-Arena window), the index lookup still holds the
    // file being replaced, so the index write is allowed.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7, video: { fileinfo: { path: '/m/old.mp4' } } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const c = clientWith(fetchImpl as never)
    await c.openFileForClip(ref, '/m/new.mov')

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(calls(fetchImpl)[2][0]).toContain('/layers/2/clips/3/open')
    expect(calls(fetchImpl)[2][1].body).toBe('file:///m/new.mov')
  })

  it('REFUSES the by-index write when that slot now holds a different file', async () => {
    // Indices address the selected deck. If the deck changed, the same indices
    // are a different clip — writing there would drop a file into the wrong slot
    // of a live show.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 99, video: { fileinfo: { path: '/m/SOMEONE-ELSE.mov' } } }),
          {
            status: 200
          }
        )
      )
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileForClip(ref, '/m/new.mov')).rejects.toBeInstanceOf(StaleClipError)
    // Crucially: no third call. Nothing was written.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses when the index lookup finds an empty clip', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 99, video: null }), { status: 200 }))
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileForClip(ref, '/m/new.mov')).rejects.toBeInstanceOf(StaleClipError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('propagates a 412 from by-id without falling back', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 412 }))
    const c = clientWith(fetchImpl as never)
    await expect(c.openFileForClip(ref, '/m/new.mov')).rejects.toBeInstanceOf(ClipLockedError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

/*
 * `fileinfo.exists` is what Arena already knows about media that is offline or
 * moved — and about everything, when Arena is on another host and the paths are
 * that machine's. The scan used to enqueue those clips anyway, and a job on a
 * path with nothing at it does not fail fast: Alley never exits, so it holds the
 * serial queue for the full 10-minute stall timeout, and the next scan tick
 * creates another one 20 s later.
 */
describe('listFileClips reports whether the media is actually there', () => {
  const compositionWith = (fileinfo: Record<string, unknown>): Record<string, unknown> => ({
    layers: [
      {
        id: 1,
        name: { value: 'Layer 1' },
        clips: [
          {
            id: 100,
            name: { value: 'Clip' },
            connected: { value: 'Disconnected' },
            video: { description: 'a.mp4\nH.264, 1920x1080, 25 Fps', fileinfo }
          }
        ]
      }
    ]
  })

  const listWith = async (fileinfo: Record<string, unknown>): Promise<ArenaClipRef[]> => {
    const c = clientWith(
      vi.fn(
        async () => new Response(JSON.stringify(compositionWith(fileinfo)), { status: 200 })
      ) as never
    )
    return c.listFileClips()
  }

  it('carries exists:false through for offline media', async () => {
    const clips = await listWith({ path: '/m/a.mp4', exists: false })
    expect(clips[0].exists).toBe(false)
  })

  it('carries exists:true through when the file is there', async () => {
    const clips = await listWith({ path: '/m/a.mp4', exists: true })
    expect(clips[0].exists).toBe(true)
  })

  it('assumes the file is there when Arena does not say', async () => {
    // A build that omits the field must not make every clip look offline and
    // silently empty the scan.
    const clips = await listWith({ path: '/m/a.mp4' })
    expect(clips[0].exists).toBe(true)
  })
})
