import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AlleycatApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    alleycat: AlleycatApi
  }
}
