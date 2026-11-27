import { screen, systemPreferences, type BrowserWindow, type Rectangle } from 'electron'
import { createRequire } from 'node:module'

const req = createRequire(__filename)

interface UiohookLike {
  on(event: 'mousedown', cb: (e: { button: number }) => void): void
  removeAllListeners(event?: string): void
  start(): void
  stop(): void
}

let hook: UiohookLike | null | undefined

function loadHook(): UiohookLike | null {
  if (hook !== undefined) return hook
  try {
    // Global mouse hooks need Accessibility permission on macOS.
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      hook = null
      return hook
    }
    hook = (req('uiohook-napi') as { uIOhook: UiohookLike }).uIOhook
  } catch {
    hook = null
  }
  return hook
}

/**
 * Streams the cursor position (and clicks, when uiohook is available) to the
 * overlay window, in coordinates relative to the recorded display.
 */
export class PointerTracker {
  private timer: NodeJS.Timeout | null = null
  private last = ''
  private hooked = false

  constructor(private readonly overlay: () => BrowserWindow | null, private readonly bounds: () => Rectangle) {}

  start(opts: { cursor: boolean; clicks: boolean }): void {
    this.stop()
    if (opts.cursor) {
      this.timer = setInterval(() => {
        const win = this.overlay()
        if (!win || win.isDestroyed()) return
        const p = screen.getCursorScreenPoint()
        const b = this.bounds()
        const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height
        const key = inside ? `${p.x},${p.y}` : 'out'
        if (key === this.last) return
        this.last = key
        win.webContents.send('overlay:pointer', inside ? { x: p.x - b.x, y: p.y - b.y } : null)
      }, 16)
    }
    if (opts.clicks) {
      const h = loadHook()
      if (h) {
        h.on('mousedown', () => {
          const win = this.overlay()
          if (!win || win.isDestroyed()) return
          // Use Electron's DIP cursor position instead of the hook's raw pixels.
          const p = screen.getCursorScreenPoint()
          const b = this.bounds()
          win.webContents.send('overlay:click', { x: p.x - b.x, y: p.y - b.y })
        })
        try {
          h.start()
          this.hooked = true
        } catch {
          h.removeAllListeners('mousedown')
        }
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.last = ''
    if (this.hooked && hook) {
      hook.removeAllListeners('mousedown')
      try {
        hook.stop()
      } catch {
        // ignore
      }
    }
    this.hooked = false
  }
}
