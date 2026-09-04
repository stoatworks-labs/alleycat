/** Types shared between the main process, the preload bridge and the renderer. */

export type JobState =
  'queued' | 'probing' | 'transcoding' | 'transcoded' | 'replacing' | 'done' | 'skipped' | 'failed'

export interface Job {
  id: string
  /** Absolute path of the source file that needs converting. */
  sourcePath: string
  /** Absolute path of the finished DXV file, once there is one. */
  outputPath?: string
  state: JobState
  /** Why the job is in its current state, for the UI and the log. */
  detail?: string
  /** Where this job came from, so the UI can explain itself. */
  origin: 'watch' | 'show-scan' | 'manual'
  queuedAt: number
  startedAt?: number
  finishedAt?: number
  /** Clip ids that were swapped to the transcoded file. */
  replacedClipIds: number[]
  /** Clip ids that are waiting for playback to stop before they can be swapped. */
  deferredClipIds: number[]
}

export interface Config {
  /** Folders watched for new footage. */
  watchFolders: string[]
  /** Where finished DXV files are moved to. Empty means "leave beside the source". */
  outputFolder: string
  /** Name of the Alley preset used for conversion. */
  preset: string
  /** Optional forced output size. Both must be set for either to apply. */
  outputWidth: number | null
  outputHeight: number | null
  /** Path to the Alley executable. */
  alleyPath: string
  arena: {
    host: string
    port: number
    /** Poll the live composition for non-DXV clips. */
    scanShow: boolean
    /** How often to poll, in seconds. */
    scanIntervalSec: number
  }
  /** Swap transcoded files into the running composition automatically. */
  autoReplace: boolean
  /** Never swap a clip that is currently connected; retry once it stops. */
  skipPlayingClips: boolean
  /** Master pause switch, toggled from the tray. */
  paused: boolean
}

export interface ArenaClipRef {
  clipId: number
  /** 1-based position in the composition, for the by-index fallback. */
  layerIndex: number
  clipIndex: number
  layerName: string
  clipName: string
  /** Absolute path of the file the clip currently points at. */
  path: string
  /**
   * Arena's own `fileinfo.exists`. False for a clip whose media is offline or
   * moved — and, when Arena runs on another host, for anything whose path is
   * that machine's. Defaults to true when a build of Arena does not report it,
   * so a missing field never silently drops every clip from the scan.
   */
  exists: boolean
  /** The codec line Arena reports, verbatim. */
  description: string
  /** Just the codec, e.g. "DXV 3.0 High Quality, No Alpha". */
  codec: string
  isDxv: boolean
  connected: boolean
}

export interface Status {
  paused: boolean
  arenaConnected: boolean
  arenaProduct: string | null
  jobs: Job[]
  /** Non-DXV clips found in the live composition on the last scan. */
  showFindings: ArenaClipRef[]
  lastScanAt: number | null
}

export const DEFAULT_CONFIG: Config = {
  watchFolders: [],
  outputFolder: '',
  preset: 'DXV High Quality No Alpha',
  outputWidth: null,
  outputHeight: null,
  alleyPath: '',
  arena: {
    host: '127.0.0.1',
    port: 8080,
    scanShow: true,
    scanIntervalSec: 20
  },
  autoReplace: true,
  skipPlayingClips: true,
  paused: false
}
