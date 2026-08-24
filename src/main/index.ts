import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { Config, Status } from '@shared/types'
import { loadConfig, saveConfig } from './services/config'
import { Engine } from './services/engine'
import { log, type LogLine } from './services/logger'
import { ArenaClient } from './services/arena'
import { listPresets } from './services/presets'
import { TRAY_ICON_PNG_BASE64 } from './trayIcon'

let tray: Tray | null = null
let win: BrowserWindow | null = null
let engine: Engine | null = null

/** A tray app should not die when its only window is closed. */
let quitting = false

function createWindow(): void {
  if (win) {
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Alleycat',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Renderer console and load failures do not appear on the main process's
  // stdout, so without these a blank window is completely silent.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = `renderer: ${message}`
    if (level >= 2) log.error(`${tag} (${sourceId}:${line})`)
    else log.info(tag)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`renderer failed to load ${url}: ${desc} (${code})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`renderer process gone: ${details.reason}`)
  })

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildTrayMenu(status: Status): Menu {
  const active = status.jobs.filter((j) =>
    ['queued', 'probing', 'transcoding', 'transcoded', 'replacing'].includes(j.state)
  ).length

  return Menu.buildFromTemplate([
    {
      label: status.arenaConnected ? `Arena: ${status.arenaProduct}` : 'Arena: not connected',
      enabled: false
    },
    { label: active === 0 ? 'Queue empty' : `${active} in progress`, enabled: false },
    { type: 'separator' },
    { label: 'Open Alleycat…', click: () => createWindow() },
    {
      label: status.paused ? 'Resume' : 'Pause',
      click: () => {
        const next = saveConfig({ paused: !status.paused })
        void engine?.applyConfig(next)
      }
    },
    { label: 'Scan show now', click: () => void engine?.scanShow() },
    { type: 'separator' },
    {
      label: 'Quit Alleycat',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function refreshTray(status: Status): void {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu(status))
  const active = status.jobs.filter((j) =>
    ['queued', 'probing', 'transcoding', 'replacing'].includes(j.state)
  ).length
  tray.setToolTip(active === 0 ? 'Alleycat — idle' : `Alleycat — ${active} in progress`)
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Alleycat')
  tray.on('click', () => createWindow())
  if (engine) refreshTray(engine.status())
}

function wireIpc(): void {
  ipcMain.handle('config:get', (): Config => loadConfig())

  ipcMain.handle('config:set', async (_e, patch: Partial<Config>): Promise<Config> => {
    const next = saveConfig(patch)
    await engine?.applyConfig(next)
    return next
  })

  ipcMain.handle('status:get', (): Status | null => engine?.status() ?? null)
  ipcMain.handle('log:history', (): LogLine[] => log.history())
  ipcMain.handle('queue:clear', (): void => engine?.clearFinished())
  ipcMain.handle('show:scan', async (): Promise<void> => engine?.scanShow())

  ipcMain.handle('queue:add', (_e, path: string): void => engine?.enqueue(path, 'manual'))

  ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:pickAlley', async (): Promise<string | null> => {
    // On macOS the executable is inside the .app bundle, so the picker has to be
    // able to descend into one rather than treating it as a single file.
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'treatPackageAsDirectory'],
      message: 'Select the Alley executable'
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('presets:list', async (): Promise<string[]> => listPresets(loadConfig().alleyPath))

  ipcMain.handle('arena:test', async (_e, host: string, port: number): Promise<string> => {
    const client = new ArenaClient({ host, port })
    return client.product()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.allansargeant.alleycat')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  // The tray is the app; a dock icon on macOS would be noise.
  if (process.platform === 'darwin') app.dock?.hide()

  const config = loadConfig()
  engine = new Engine(config)
  engine.on('status', (status: Status) => {
    refreshTray(status)
    win?.webContents.send('status:update', status)
  })
  log.on('line', (line: LogLine) => win?.webContents.send('log:line', line))

  wireIpc()
  createTray()
  engine.start()

  // First run has nothing configured, so show the window rather than leaving a
  // tray icon that appears to do nothing.
  if (config.watchFolders.length === 0) createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Deliberately does not quit — closing the config window leaves Alleycat
  // running in the tray, which is the whole point of it.
})

app.on('before-quit', () => {
  quitting = true
  void engine?.stop()
})

export { quitting }
