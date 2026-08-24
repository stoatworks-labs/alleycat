import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { rename, copyFile, unlink, mkdir } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ArenaClipRef, Config, Job, Status } from '@shared/types'
import { ArenaClient, ClipLockedError, StaleClipError } from './arena'
import { convert, predictOutputPath, verifyAlley } from './alley'
import { probeFile, isVideoPath } from './probe'
import { log } from './logger'

/**
 * Path comparison against whatever Arena reports.
 *
 * macOS and Windows filesystems are case-insensitive in practice, and a clip
 * path that differs only in case is the same file. Comparing raw strings would
 * silently fail to match and the swap would never happen.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const r = resolve(p).split(sep).join('/')
    return process.platform === 'linux' ? r : r.toLowerCase()
  }
  return norm(a) === norm(b)
}

/** Move across devices safely — `rename` fails with EXDEV between volumes. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await unlink(from)
  }
}

export class Engine extends EventEmitter {
  private config: Config
  private arena: ArenaClient
  private jobs = new Map<string, Job>()
  private watchers: FSWatcher[] = []
  private scanTimer: NodeJS.Timeout | null = null
  private running = false
  private queue: string[] = []

  /**
   * Finished conversions that still have clips to swap, kept for the whole
   * session. A clip that was playing when its replacement was ready gets picked
   * up on a later tick rather than being dropped.
   */
  private pendingReplacements = new Map<string, string>()

  /** Outputs Alleycat produced, so a watch folder does not re-ingest its own results. */
  private ownOutputs = new Set<string>()

  private showFindings: ArenaClipRef[] = []
  private lastScanAt: number | null = null
  private arenaProduct: string | null = null

  constructor(config: Config) {
    super()
    this.config = config
    this.arena = new ArenaClient({ host: config.arena.host, port: config.arena.port })
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.startWatchers()
    this.startScan()
    void this.pump()
  }

  async stop(): Promise<void> {
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.scanTimer = null
    await Promise.all(this.watchers.map((w) => w.close()))
    this.watchers = []
  }

  async applyConfig(config: Config): Promise<void> {
    const arenaChanged =
      config.arena.host !== this.config.arena.host || config.arena.port !== this.config.arena.port
    this.config = config
    if (arenaChanged) {
      this.arena = new ArenaClient({ host: config.arena.host, port: config.arena.port })
      this.arenaProduct = null
    }
    await this.stop()
    this.start()
    this.emitStatus()
  }

  // ----------------------------------------------------------------- watching

  private startWatchers(): void {
    for (const folder of this.config.watchFolders) {
      const w = watch(folder, {
        ignoreInitial: false,
        depth: 4,
        // Footage is copied onto a show drive, often slowly. Do not touch a file
        // until it has stopped growing, or Alley reads a half-written source.
        awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 }
      })
      w.on('add', (path: string) => this.enqueue(path, 'watch'))
      w.on('error', (err: unknown) => log.error(`watcher error on ${folder}: ${String(err)}`))
      this.watchers.push(w)
      log.info(`watching ${folder}`)
    }
  }

  // -------------------------------------------------------------- show scanning

  private startScan(): void {
    if (!this.config.arena.scanShow) return
    const ms = Math.max(5, this.config.arena.scanIntervalSec) * 1000
    this.scanTimer = setInterval(() => void this.scanShow(), ms)
    void this.scanShow()
  }

  /**
   * Poll the live composition: queue anything that is not DXV, and retry any
   * swap that was deferred because its clip was playing.
   */
  async scanShow(): Promise<void> {
    if (this.config.paused) return
    try {
      this.arenaProduct ??= await this.arena.product()
      const clips = await this.arena.listFileClips()
      this.lastScanAt = Date.now()
      this.showFindings = clips.filter((c) => !c.isDxv)

      for (const clip of this.showFindings) {
        // Arena's description is only a hint; probeFile decides before converting.
        if (isVideoPath(clip.path)) this.enqueue(clip.path, 'show-scan')
      }

      await this.applyPendingReplacements(clips)
    } catch (err) {
      this.arenaProduct = null
      log.warn(`show scan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.emitStatus()
  }

  // -------------------------------------------------------------------- queue

  enqueue(sourcePath: string, origin: Job['origin']): void {
    if (!isVideoPath(sourcePath)) return
    if (this.ownOutputs.has(resolve(sourcePath))) return
    // Already known, in any state that is not a finished failure.
    for (const job of this.jobs.values()) {
      if (samePath(job.sourcePath, sourcePath) && job.state !== 'failed') return
    }

    const job: Job = {
      id: randomUUID(),
      sourcePath,
      state: 'queued',
      origin,
      queuedAt: Date.now(),
      replacedClipIds: [],
      deferredClipIds: []
    }
    this.jobs.set(job.id, job)
    this.queue.push(job.id)
    log.info(`queued ${basename(sourcePath)} (${origin})`)
    this.emitStatus()
    void this.pump()
  }

  /** One conversion at a time — Alley is a GPU app and will not thank us for three. */
  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        if (this.config.paused) break
        const id = this.queue.shift()
        if (!id) break
        const job = this.jobs.get(id)
        if (!job) continue
        await this.runJob(job)
      }
    } finally {
      this.running = false
    }
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch)
    this.emitStatus()
  }

  private async runJob(job: Job): Promise<void> {
    this.update(job, { state: 'probing', startedAt: Date.now() })

    const probe = await probeFile(job.sourcePath)
    if (probe.isDxv) {
      this.update(job, {
        state: 'skipped',
        detail: `already DXV (${probe.fourcc})`,
        finishedAt: Date.now()
      })
      return
    }
    if (!probe.isVideo) {
      this.update(job, { state: 'skipped', detail: 'not video', finishedAt: Date.now() })
      return
    }

    const alleyCheck = verifyAlley(this.config.alleyPath)
    if (!alleyCheck.ok) {
      this.update(job, { state: 'failed', detail: alleyCheck.reason, finishedAt: Date.now() })
      log.error(`cannot convert ${basename(job.sourcePath)}: ${alleyCheck.reason}`)
      return
    }

    // Alley names its output after the source, so `clip.mp4` becomes `clip.mov`.
    // If a *different* `clip.mov` is already sitting there — a common shape,
    // since a folder often holds both an h264 offline and a DXV master — Alley
    // will overwrite it without asking. Refuse rather than destroy it.
    const predicted = predictOutputPath(job.sourcePath, this.config.preset)
    if (existsSync(predicted) && !this.ownOutputs.has(resolve(predicted))) {
      const detail = `would overwrite existing ${basename(predicted)}`
      this.update(job, { state: 'failed', detail, finishedAt: Date.now() })
      log.error(`skipped ${basename(job.sourcePath)}: ${detail}`)
      return
    }

    const was = probe.isHap ? `Hap (${probe.fourcc})` : (probe.fourcc ?? 'non-DXV')
    this.update(job, { state: 'transcoding', detail: `converting from ${was}` })
    log.info(`converting ${basename(job.sourcePath)} from ${was}`)

    let produced: string
    try {
      produced = await convert({
        alleyPath: this.config.alleyPath,
        sourcePath: job.sourcePath,
        preset: this.config.preset,
        width: this.config.outputWidth,
        height: this.config.outputHeight,
        onProgress: (m) => this.update(job, { detail: m })
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.update(job, { state: 'failed', detail, finishedAt: Date.now() })
      log.error(`conversion failed for ${basename(job.sourcePath)}: ${detail}`)
      return
    }

    let finalPath = produced
    if (this.config.outputFolder) {
      try {
        await mkdir(this.config.outputFolder, { recursive: true })
        finalPath = join(this.config.outputFolder, basename(produced))
        await moveFile(produced, finalPath)
      } catch (err) {
        // A failed move is not a failed conversion — keep the file where it is.
        log.warn(`could not move output to ${this.config.outputFolder}: ${String(err)}`)
        finalPath = produced
      }
    }

    this.ownOutputs.add(resolve(finalPath))
    this.update(job, { state: 'transcoded', outputPath: finalPath, detail: undefined })
    log.info(`converted ${basename(job.sourcePath)} -> ${basename(finalPath)}`)

    if (this.config.autoReplace) {
      this.pendingReplacements.set(resolve(job.sourcePath), finalPath)
      await this.applyPendingReplacements()
    } else {
      this.update(job, { state: 'done', finishedAt: Date.now() })
    }
  }

  // -------------------------------------------------------------- replacement

  /**
   * Swap every clip pointing at a converted source over to its DXV copy.
   *
   * A clip that is currently playing is left alone and retried on the next scan
   * tick — pulling the file out from under a live output is the one thing this
   * tool must never do. Arena can also refuse with a 412 of its own, which is
   * treated the same way.
   */
  async applyPendingReplacements(known?: ArenaClipRef[]): Promise<void> {
    if (this.pendingReplacements.size === 0) return

    let clips: ArenaClipRef[]
    try {
      clips = known ?? (await this.arena.listFileClips())
    } catch (err) {
      log.warn(`cannot list clips to replace: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    for (const [sourcePath, outputPath] of this.pendingReplacements) {
      const matches = clips.filter((c) => samePath(c.path, sourcePath))
      const job = [...this.jobs.values()].find((j) => samePath(j.sourcePath, sourcePath))

      if (matches.length === 0) {
        // Converted from a watch folder, not currently in the show. Keep it
        // pending in case the clip is loaded later in the session.
        if (job && job.state === 'transcoded') {
          this.update(job, { state: 'done', detail: 'not in composition', finishedAt: Date.now() })
        }
        continue
      }

      if (job) this.update(job, { state: 'replacing' })
      const replaced: number[] = []
      const deferred: number[] = []

      for (const clip of matches) {
        if (this.config.skipPlayingClips && clip.connected) {
          deferred.push(clip.clipId)
          continue
        }
        try {
          await this.arena.openFileInClip(clip.clipId, outputPath)
          replaced.push(clip.clipId)
          log.info(`swapped ${clip.layerName} / ${clip.clipName} to ${basename(outputPath)}`)
        } catch (err) {
          if (err instanceof ClipLockedError) {
            deferred.push(clip.clipId)
            log.info(`deferred ${clip.layerName} / ${clip.clipName}: ${err.message}`)
          } else if (err instanceof StaleClipError) {
            // The composition was reloaded under us and ids were reassigned.
            // Keep the replacement pending; the next scan re-matches by path.
            deferred.push(clip.clipId)
            log.info(`clip id went stale for ${clip.clipName}, will re-match on next scan`)
          } else {
            log.error(`swap failed for clip ${clip.clipId}: ${String(err)}`)
          }
        }
      }

      if (job) {
        this.update(job, {
          replacedClipIds: [...job.replacedClipIds, ...replaced],
          deferredClipIds: deferred,
          state: deferred.length > 0 ? 'transcoded' : 'done',
          detail:
            deferred.length > 0
              ? `${deferred.length} clip(s) playing — will retry`
              : `swapped ${replaced.length} clip(s)`,
          finishedAt: deferred.length > 0 ? undefined : Date.now()
        })
      }

      if (deferred.length === 0) this.pendingReplacements.delete(sourcePath)
    }
    this.emitStatus()
  }

  // ------------------------------------------------------------------- status

  status(): Status {
    return {
      paused: this.config.paused,
      arenaConnected: this.arenaProduct !== null,
      arenaProduct: this.arenaProduct,
      jobs: [...this.jobs.values()].sort((a, b) => b.queuedAt - a.queuedAt),
      showFindings: this.showFindings,
      lastScanAt: this.lastScanAt
    }
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (['done', 'skipped', 'failed'].includes(job.state)) this.jobs.delete(id)
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }
}
