import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Config, Status } from '../shared/types'

export interface LogLine {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

/** The whole surface the renderer is allowed to touch. */
const api = {
  /** Needed by the renderer to clear the macOS traffic lights under titleBarStyle: hiddenInset. */
  platform: process.platform as NodeJS.Platform,
  getConfig: (): Promise<Config> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Partial<Config>): Promise<Config> => ipcRenderer.invoke('config:set', patch),
  getStatus: (): Promise<Status | null> => ipcRenderer.invoke('status:get'),
  getLog: (): Promise<LogLine[]> => ipcRenderer.invoke('log:history'),
  clearFinished: (): Promise<void> => ipcRenderer.invoke('queue:clear'),
  scanShow: (): Promise<void> => ipcRenderer.invoke('show:scan'),
  addToQueue: (path: string): Promise<void> => ipcRenderer.invoke('queue:add', path),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickAlley: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickAlley'),
  listPresets: (): Promise<string[]> => ipcRenderer.invoke('presets:list'),
  testArena: (host: string, port: number): Promise<string> =>
    ipcRenderer.invoke('arena:test', host, port),

  onStatus: (cb: (s: Status) => void): (() => void) => {
    const handler = (_e: unknown, s: Status): void => cb(s)
    ipcRenderer.on('status:update', handler)
    return () => ipcRenderer.removeListener('status:update', handler)
  },
  onLog: (cb: (l: LogLine) => void): (() => void) => {
    const handler = (_e: unknown, l: LogLine): void => cb(l)
    ipcRenderer.on('log:line', handler)
    return () => ipcRenderer.removeListener('log:line', handler)
  }
}

export type AlleycatApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('alleycat', api)
} else {
  // @ts-ignore fallback when contextIsolation is off
  window.alleycat = api
}
