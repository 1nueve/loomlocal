import {
  desktopCapturer,
  dialog,
  globalShortcut,
  screen,
  type BrowserWindow,
  type Display,
  type DisplayMediaRequestHandlerHandlerRequest,
  type Streams
} from 'electron'
import { appendFile, rm } from 'node:fs/promises'
import { anchorBottomLeft, bubbleSize } from '../shared/bubble'
import { BUBBLE_PX, type BubbleShape, type BubbleSize, type DrawState, type Marker, type RecCommand, type RecordingOptions, type RecStatus, type Settings, type SourceInfo } from '../shared/types'
import type { LibraryService } from './library-service'
import { PointerTracker } from './pointer'
import { newId } from './store'
import { RecordingTray } from './tray'
import { createBubbleWindow, createOverlayWindow, createToolbarWindow } from './windows'

interface Deps {
  mainWindow: () => BrowserWindow | null
  settings: () => Settings
  library: LibraryService
}

function alive(w: BrowserWindow | null): w is BrowserWindow {
  return !!w && !w.isDestroyed()
}

/**
 * Orchestrates one recording session across windows. The MediaRecorder itself
 * runs in the main window's renderer (hidden while recording); this class
 * provides the capture source, writes chunks to disk and drives the floating
 * bubble, overlay and toolbar windows.
 */
export class RecordingController {
  private opts: RecordingOptions | null = null
  private display: Display = screen.getPrimaryDisplay()
  private bubble: BrowserWindow | null = null
  private bubbleCamera: string | null = null
  private bubbleMic: string | null = null
  /** True while the user wants the toolbar hidden during this recording. */
  private toolbarHidden = false
  private readonly tray: RecordingTray
  private overlay: BrowserWindow | null = null
  private toolbar: BrowserWindow | null = null
  private recId: string | null = null
  private writes: Promise<void> = Promise.resolve()
  private status: RecStatus = { state: 'idle', elapsedMs: 0, markerCount: 0 }
  private drawing: DrawState
  private pendingCountdown: number | null = null
  private sourceNames = new Map<string, string>()
  private readonly pointer: PointerTracker

  constructor(private readonly deps: Deps) {
    this.drawing = { enabled: false, tool: 'pen', color: '#ff3b5c', width: deps.settings().drawWidth }
    this.tray = new RecordingTray({
      togglePause: () => this.command({ type: 'toggle-pause' }),
      marker: () => this.command({ type: 'marker' }),
      toggleDrawing: () => this.setDrawing({ ...this.drawing, enabled: !this.drawing.enabled }),
      clearDrawing: () => this.clearDrawing(),
      toggleToolbar: () => this.toggleToolbar(),
      restart: () => void this.confirmThen('¿Reiniciar la grabación? Se borrará lo grabado.', 'Reiniciar', { type: 'restart' }),
      cancel: () => void this.confirmThen('¿Cancelar y borrar esta grabación?', 'Cancelar grabación', { type: 'cancel' }),
      finish: () => this.command({ type: 'finish' }),
      toolbarVisible: () => alive(this.toolbar) && this.toolbar.isVisible(),
      drawing: () => this.drawing.enabled
    })
    this.pointer = new PointerTracker(
      () => this.overlay,
      () => this.display.bounds
    )
  }

  get active(): boolean {
    return this.recId !== null
  }

  async listSources(): Promise<SourceInfo[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    const ownTitles = new Set(['LoomLocal'])
    this.sourceNames = new Map(sources.map((s) => [s.id, s.name]))
    return sources
      .filter((s) => !ownTitles.has(s.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
        displayId: s.display_id || undefined
      }))
  }

  /** Used by session.setDisplayMediaRequestHandler. */
  readonly handleDisplayMedia = (
    _req: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams) => void
  ): void => {
    let answered = false
    const reply = (streams: Streams) => {
      if (answered) return
      answered = true
      try {
        callback(streams)
      } catch {
        // Electron rejects the request in the renderer; nothing else to do here.
      }
    }
    void (async () => {
      try {
        const wantsLoopback = !!this.opts?.systemAudio && process.platform !== 'linux'
        // Pass the chosen source by id. Re-enumerating sources here starts a
        // second capturer that makes every other request fail on X11.
        let video: { id: string; name: string } | undefined
        const id = this.opts?.sourceId
        if (id && this.sourceNames.has(id)) video = { id, name: this.sourceNames.get(id)! }
        if (!video) {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
          const s = sources.find((x) => x.id === id) ?? sources.find((x) => x.id.startsWith('screen:'))
          if (s) video = { id: s.id, name: s.name }
        }
        if (!video) return reply({})
        reply(wantsLoopback ? { video, audio: 'loopback' } : { video })
      } catch {
        reply({})
      }
    })()
  }

  select(opts: RecordingOptions): void {
    this.opts = opts
    const displays = screen.getAllDisplays()
    this.display =
      (opts.displayId && displays.find((d) => String(d.id) === opts.displayId)) || screen.getPrimaryDisplay()
  }

  // ---------- camera bubble ----------

  /** The mic only drives the voice ring; the recording opens its own stream. */
  showBubble(cameraId: string | null, micId: string | null = null): void {
    if (!cameraId) {
      this.closeBubble()
      return
    }
    if (alive(this.bubble) && this.bubbleCamera === cameraId && this.bubbleMic === micId) return
    this.closeBubble()
    const s = this.deps.settings()
    const width = s.bubbleWidth || BUBBLE_PX[s.bubbleSize]
    this.bubble = createBubbleWindow(this.display, bubbleSize(width, s.bubbleShape, this.display.workArea), cameraId, micId)
    this.bubbleCamera = cameraId
    this.bubbleMic = micId
    this.bubble.on('closed', () => {
      this.bubble = null
      this.bubbleCamera = null
      this.bubbleMic = null
    })
  }

  resizeBubble(size: BubbleSize): number | null {
    return this.resizeBubbleTo(BUBBLE_PX[size])
  }

  /** Free resize from the bubble's handle. Returns the width actually applied. */
  resizeBubbleTo(width: number, shape: BubbleShape = this.deps.settings().bubbleShape): number | null {
    if (!alive(this.bubble)) return null
    const b = this.bubble.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    const size = bubbleSize(width, shape, area)
    if (size.width !== b.width || size.height !== b.height) this.bubble.setBounds(anchorBottomLeft(b, size))
    return size.width
  }

  /** Re-applies the aspect ratio after a shape change. */
  setBubbleShape(shape: BubbleShape): void {
    if (!alive(this.bubble)) return
    this.resizeBubbleTo(this.bubble.getBounds().width, shape)
  }

  private moveBubbleToDisplay(): void {
    if (!alive(this.bubble)) return
    const b = this.bubble.getBounds()
    const current = screen.getDisplayMatching(b)
    if (current.id === this.display.id) return
    const wa = this.display.workArea
    this.bubble.setBounds({ x: wa.x + 32, y: wa.y + wa.height - b.height - 32, width: b.width, height: b.height })
  }

  private closeBubble(): void {
    if (alive(this.bubble)) this.bubble.close()
    this.bubble = null
    this.bubbleCamera = null
    this.bubbleMic = null
  }

  // ---------- toolbar visibility ----------

  private hideWhileRecording(): boolean {
    return this.deps.settings().hideToolbarWhileRecording
  }

  setToolbarVisible(visible: boolean): void {
    this.toolbarHidden = !visible
    if (alive(this.toolbar)) {
      if (visible) {
        this.toolbar.showInactive()
        this.toolbar.moveTop()
      } else this.toolbar.hide()
    }
    this.tray.invalidate()
  }

  toggleToolbar(): void {
    this.setToolbarVisible(!(alive(this.toolbar) && this.toolbar.isVisible()))
  }

  private async confirmThen(message: string, confirmLabel: string, cmd: RecCommand): Promise<void> {
    const res = await dialog.showMessageBox({
      type: 'question',
      message,
      buttons: [confirmLabel, 'Seguir grabando'],
      defaultId: 1,
      cancelId: 1
    })
    if (res.response === 0) this.command(cmd)
  }

  // ---------- session lifecycle ----------

  /** Renderer has its streams; show the countdown and floating controls. */
  prepare(): void {
    if (!this.recId) this.recId = newId()
    const s = this.deps.settings()
    const main = this.deps.mainWindow()
    if (alive(main)) main.hide()
    this.moveBubbleToDisplay()

    if (!alive(this.overlay)) {
      this.overlay = createOverlayWindow(this.display)
      this.overlay.on('closed', () => (this.overlay = null))
    }
    // The toolbar is shown for the countdown and hidden once recording starts
    // when "hide while recording" is on.
    this.toolbarHidden = false
    if (!alive(this.toolbar)) {
      this.toolbar = createToolbarWindow(this.display, () => !this.toolbarHidden)
      this.toolbar.on('closed', () => (this.toolbar = null))
    } else this.setToolbarVisible(true)
    this.tray.show()
    this.registerShortcuts()
    this.pointer.start({ cursor: s.highlightCursor, clicks: s.clickRipples })

    const seconds = Math.max(0, Math.min(10, Math.round(s.countdownSeconds)))
    this.setStatus({ state: 'countdown', elapsedMs: 0, markerCount: 0 })
    if (seconds === 0) {
      this.countdownDone()
      return
    }
    // The overlay may still be loading: it also pulls this via overlayInit().
    this.pendingCountdown = seconds
    const overlay = this.overlay
    overlay.setIgnoreMouseEvents(false)
    overlay.setFocusable(true)
    overlay.focus()
    if (!overlay.webContents.isLoading()) overlay.webContents.send('overlay:countdown', { seconds })
  }

  overlayInit(): { countdown: number | null; drawing: DrawState } {
    return { countdown: this.pendingCountdown, drawing: this.drawing }
  }

  currentStatus(): RecStatus {
    return this.status
  }

  countdownDone(): void {
    if (this.pendingCountdown === null && this.status.state !== 'countdown') return
    this.pendingCountdown = null
    if (alive(this.overlay)) {
      this.overlay.setIgnoreMouseEvents(!this.drawing.enabled, { forward: true })
      this.overlay.setFocusable(this.drawing.enabled)
      this.overlay.webContents.send('overlay:countdown', null)
    }
    if (this.hideWhileRecording()) this.setToolbarVisible(false)
    else if (alive(this.toolbar)) this.toolbar.moveTop()
    const main = this.deps.mainWindow()
    if (alive(main)) main.webContents.send('rec:go')
  }

  chunk(data: ArrayBuffer): Promise<void> {
    const id = this.recId
    if (!id) return Promise.resolve()
    const path = this.deps.library.partPath(id)
    const buf = Buffer.from(data)
    this.writes = this.writes.then(() => appendFile(path, buf)).catch(() => undefined)
    return this.writes
  }

  /** Throws away what was recorded so far (restart or cancel). */
  async discard(): Promise<void> {
    await this.writes
    if (this.recId) await rm(this.deps.library.partPath(this.recId), { force: true })
    this.recId = null
    this.clearDrawing()
  }

  async finish(payload: { durationMs: number; markers: Marker[] }): Promise<string | null> {
    await this.writes
    const id = this.recId
    this.recId = null
    this.teardown()
    if (!id) return null
    await this.deps.library.ingest(id, payload.durationMs, payload.markers)
    const main = this.deps.mainWindow()
    if (alive(main)) main.webContents.send('navigate', `/video/${id}`)
    return id
  }

  async cancel(): Promise<void> {
    await this.discard()
    this.teardown()
  }

  private teardown(): void {
    this.pointer.stop()
    this.tray.destroy()
    this.toolbarHidden = false
    this.unregisterShortcuts()
    if (alive(this.overlay)) this.overlay.close()
    if (alive(this.toolbar)) this.toolbar.close()
    this.closeBubble()
    this.drawing = { ...this.drawing, enabled: false }
    this.setStatus({ state: 'idle', elapsedMs: 0, markerCount: 0 })
    const main = this.deps.mainWindow()
    if (alive(main)) {
      main.show()
      main.focus()
    }
  }

  // ---------- commands & status ----------

  command(cmd: RecCommand): void {
    const main = this.deps.mainWindow()
    if (cmd.type === 'toggle-pause') {
      cmd = this.status.state === 'paused' ? { type: 'resume' } : { type: 'pause' }
    }
    if (alive(main)) main.webContents.send('rec:command', cmd)
  }

  setStatus(status: RecStatus): void {
    this.status = status
    if (alive(this.toolbar)) this.toolbar.webContents.send('rec:state', status)
    this.tray.update(status)
  }

  setDrawing(state: DrawState): void {
    this.drawing = state
    // Esc leaves drawing mode; only grab it globally while drawing.
    if (state.enabled && this.active) {
      if (!globalShortcut.isRegistered('Escape')) {
        globalShortcut.register('Escape', () => this.setDrawing({ ...this.drawing, enabled: false }))
      }
    } else if (globalShortcut.isRegistered('Escape')) {
      globalShortcut.unregister('Escape')
    }
    if (alive(this.overlay)) {
      this.overlay.setIgnoreMouseEvents(!state.enabled, { forward: true })
      this.overlay.setFocusable(state.enabled)
      if (state.enabled) this.overlay.focus()
      this.overlay.webContents.send('overlay:drawing', state)
      if (alive(this.toolbar) && this.toolbar.isVisible()) this.toolbar.moveTop()
      if (alive(this.bubble)) this.bubble.moveTop()
    }
    if (alive(this.toolbar)) this.toolbar.webContents.send('overlay:drawing', state)
    this.tray.invalidate()
  }

  clearDrawing(): void {
    if (alive(this.overlay)) this.overlay.webContents.send('overlay:clear')
  }

  private registerShortcuts(): void {
    this.unregisterShortcuts()
    const bind = (accel: string, fn: () => void) => {
      try {
        globalShortcut.register(accel, fn)
      } catch {
        // another app owns it
      }
    }
    bind('CommandOrControl+Shift+P', () => this.command({ type: 'toggle-pause' }))
    bind('CommandOrControl+Shift+S', () => this.command({ type: 'finish' }))
    bind('CommandOrControl+Shift+M', () => this.command({ type: 'marker' }))
    bind('CommandOrControl+Shift+D', () => this.setDrawing({ ...this.drawing, enabled: !this.drawing.enabled }))
    bind('CommandOrControl+Shift+E', () => this.clearDrawing())
    bind('CommandOrControl+Shift+H', () => this.toggleToolbar())
  }

  private unregisterShortcuts(): void {
    for (const a of [
      'CommandOrControl+Shift+P',
      'CommandOrControl+Shift+S',
      'CommandOrControl+Shift+M',
      'CommandOrControl+Shift+D',
      'CommandOrControl+Shift+E',
      'CommandOrControl+Shift+H',
      'Escape'
    ]) {
      if (globalShortcut.isRegistered(a)) globalShortcut.unregister(a)
    }
  }
}
