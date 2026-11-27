import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type BubbleSize, type DrawState, type Marker, type RecCommand, type RecordingOptions, type RecStatus, type Settings, type ShareInfo, type VideoPatch } from '../shared/types'
import { resolveFfmpeg } from './ffmpeg'
import { readJson, writeJson } from './json-file'
import { LibraryService, libraryDirs } from './library-service'
import { openPermissionSettings, permissionStatus, requestPermission } from './permissions'
import { RecordingController } from './recording'
import { lanAddress, ShareServer } from './share-server'
import { checkWhisper } from './transcribe'
import { createMainWindow } from './windows'

// ---------- platform switches (must run before "ready") ----------
if (process.platform === 'darwin') {
  // System-audio loopback through ScreenCaptureKit (macOS 13+).
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride')
}
if (process.platform === 'linux') {
  // Screen capture on Wayland goes through PipeWire + xdg-desktop-portal.
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
  if (process.env.LOOMLOCAL_E2E) app.commandLine.appendSwitch('enable-transparent-visuals')
}
if (process.env.LOOMLOCAL_E2E && !process.env.LOOMLOCAL_E2E_REAL_SCREEN) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

if (!app.requestSingleInstanceLock()) app.quit()

const dataRoot = process.env.LOOMLOCAL_DATA_DIR || join(homedir(), 'LoomLocal')
const settingsFile = process.env.LOOMLOCAL_DATA_DIR
  ? join(dataRoot, 'settings.json')
  : join(app.getPath('userData'), 'settings.json')

let settings: Settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(settingsFile, {}) }
let mainWindow: BrowserWindow | null = null

const dirs = libraryDirs(dataRoot)
const library = new LibraryService(dirs, resolveFfmpeg(), () => settings)
const share = new ShareServer(library.store, dirs)
// Created after "ready": it uses the screen module.
let recording: RecordingController

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

library.on('changed', (id?: string) => broadcast('library:changed', id))

async function startShare(): Promise<void> {
  await share.start(settings.shareOnLan ? '0.0.0.0' : '127.0.0.1', settings.sharePort)
}

function shareInfo(): ShareInfo {
  const lan = settings.shareOnLan ? lanAddress() : null
  return {
    localBase: `http://127.0.0.1:${share.port}`,
    lanBase: lan ? `http://${lan}:${share.port}` : null,
    lanEnabled: settings.shareOnLan,
    port: share.port
  }
}

/** Only accept IPC from our own windows. */
function fromApp(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e)) throw new Error('Origen no permitido')
    return fn(...(args as A))
  })
}

function listen<A extends unknown[]>(channel: string, fn: (...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromApp(e)) fn(...(args as A))
  })
}

function registerIpc(): void {
  handle('sources:list', () => recording.listSources())
  handle('settings:get', () => settings)
  handle('settings:set', async (patch: Partial<Settings>) => {
    const prevLan = settings.shareOnLan
    const prevPort = settings.sharePort
    settings = { ...settings, ...patch }
    writeJson(settingsFile, settings)
    if (settings.shareOnLan !== prevLan || settings.sharePort !== prevPort) await startShare()
    broadcast('settings:changed', settings)
    return settings
  })
  handle('perm:status', () => permissionStatus())
  handle('perm:request', (kind: 'camera' | 'microphone') => requestPermission(kind))
  handle('perm:open', (kind: string) => openPermissionSettings(kind))
  // macOS only applies a new Screen Recording permission after a restart.
  listen('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  handle('bubble:show', (cameraId: string | null) => recording.showBubble(cameraId))
  listen('bubble:resize', (size: BubbleSize) => {
    recording.resizeBubble(size)
    settings = { ...settings, bubbleSize: size }
    writeJson(settingsFile, settings)
  })
  listen('bubble:shape', () => {
    settings = { ...settings, bubbleShape: settings.bubbleShape === 'circle' ? 'rounded' : 'circle' }
    writeJson(settingsFile, settings)
    broadcast('settings:changed', settings)
  })

  handle('rec:select', (opts: RecordingOptions) => recording.select(opts))
  handle('rec:prepare', () => recording.prepare())
  handle('rec:chunk', (data: ArrayBuffer) => recording.chunk(data))
  listen('rec:state', (s: RecStatus) => recording.setStatus(s))
  handle('rec:discard', () => recording.discard())
  handle('rec:finish', (p: { durationMs: number; markers: Marker[] }) => recording.finish(p))
  handle('rec:cancel', () => recording.cancel())
  listen('rec:command', (cmd: RecCommand) => recording.command(cmd))
  listen('countdown:done', () => recording.countdownDone())
  handle('overlay:init', () => recording.overlayInit())
  handle('rec:status', () => recording.currentStatus())
  listen('draw:set', (s: DrawState) => recording.setDrawing(s))
  listen('draw:clear', () => recording.clearDrawing())

  handle('videos:list', () => library.store.list())
  handle('videos:get', (id: string) => library.store.get(id))
  handle('videos:update', (id: string, patch: VideoPatch) => library.update(id, patch))
  handle('videos:delete', (id: string) => library.delete(id))
  handle('videos:retry-transcription', (id: string) => library.enqueueTranscription(id))
  handle('videos:reveal', (id: string) => {
    const p = library.videoPath(id)
    if (p) shell.showItemInFolder(p)
  })
  handle('videos:export', async (id: string) => {
    const v = library.store.get(id)
    const src = library.videoPath(id)
    if (!v || !src) return null
    const ext = v.file.slice(v.file.lastIndexOf('.'))
    const safe = v.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'grabacion'
    const opts = { defaultPath: join(app.getPath('downloads'), `${safe}${ext}`) }
    const res = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await copyFile(src, res.filePath)
    return res.filePath
  })
  handle('share:info', () => shareInfo())
  listen('clipboard:write', (text: string) => clipboard.writeText(String(text)))
  handle('whisper:test', () => {
    const r = checkWhisper(settings)
    return { ok: r.ok, message: r.message }
  })
}

app.whenReady().then(async () => {
  recording = new RecordingController({ mainWindow: () => mainWindow, settings: () => settings, library })
  session.defaultSession.setDisplayMediaRequestHandler(recording.handleDisplayMedia)
  // Camera, microphone and screen capture are the only permissions we grant.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const url = wc.getURL()
    const ours = url.startsWith('file://') || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
    cb(ours && (permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write'))
  })
  registerIpc()
  library.recoverOrphans()
  await startShare()
  mainWindow = createMainWindow()
  mainWindow.on('closed', () => (mainWindow = null))

  app.on('activate', () => {
    if (!mainWindow) {
      mainWindow = createMainWindow()
      mainWindow.on('closed', () => (mainWindow = null))
    } else mainWindow.show()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || process.env.LOOMLOCAL_E2E) app.quit()
})

app.on('will-quit', () => {
  void share.stop()
})
