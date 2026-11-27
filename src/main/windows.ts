import { BrowserWindow, type BrowserWindowConstructorOptions, type Display } from 'electron'
import { join } from 'node:path'

const preload = join(__dirname, '../preload/index.js')

export function loadRoute(win: BrowserWindow, route: string): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

function make(opts: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    ...opts,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      ...opts.webPreferences
    }
  })
  // Never let a renderer open other windows or navigate away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (!(dev && url.startsWith(dev)) && !url.startsWith('file://')) e.preventDefault()
  })
  return win
}

const floating: BrowserWindowConstructorOptions = {
  frame: false,
  transparent: true,
  resizable: false,
  movable: true,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  hasShadow: false,
  alwaysOnTop: true,
  backgroundColor: '#00000000'
}

function pinOnTop(win: BrowserWindow, relativeLevel = 0): void {
  win.setAlwaysOnTop(true, 'screen-saver', relativeLevel)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

export function createMainWindow(): BrowserWindow {
  const win = make({
    width: 1180,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    title: 'LoomLocal',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true
  })
  win.once('ready-to-show', () => win.show())
  loadRoute(win, '/record')
  return win
}

export function createBubbleWindow(
  display: Display,
  size: { width: number; height: number },
  cameraId: string,
  micId: string | null
): BrowserWindow {
  const wa = display.workArea
  const win = make({
    ...floating,
    width: size.width,
    height: size.height,
    x: wa.x + 32,
    y: wa.y + wa.height - size.height - 32
  })
  pinOnTop(win, 1)
  const mic = micId ? `&mic=${encodeURIComponent(micId)}` : ''
  loadRoute(win, `/bubble?cam=${encodeURIComponent(cameraId)}${mic}`)
  win.once('ready-to-show', () => win.showInactive())
  return win
}

/** Full-screen, click-through layer for countdown, cursor highlight and drawing. */
export function createOverlayWindow(display: Display): BrowserWindow {
  const b = display.bounds
  const win = make({
    ...floating,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    focusable: false,
    enableLargerThanScreen: true
  })
  win.setIgnoreMouseEvents(true, { forward: true })
  pinOnTop(win, 0)
  loadRoute(win, '/overlay')
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export const TOOLBAR_SIZE = { width: 900, height: 64 }

export function createToolbarWindow(display: Display, shouldShow: () => boolean = () => true): BrowserWindow {
  const wa = display.workArea
  const win = make({
    ...floating,
    width: TOOLBAR_SIZE.width,
    height: TOOLBAR_SIZE.height,
    x: Math.round(wa.x + (wa.width - TOOLBAR_SIZE.width) / 2),
    y: wa.y + wa.height - TOOLBAR_SIZE.height - 24
  })
  pinOnTop(win, 2)
  // Keeps the controls out of the recording where the OS capture honours it
  // (macOS 13+ with ScreenCaptureKit, Windows). Not on macOS 12 or Linux.
  win.setContentProtection(true)
  loadRoute(win, '/toolbar')
  win.once('ready-to-show', () => {
    if (shouldShow()) win.showInactive()
  })
  return win
}
