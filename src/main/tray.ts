import { Menu, nativeImage, Tray } from 'electron'
import { formatDuration } from '../shared/vtt'
import type { RecStatus } from '../shared/types'

const DOT_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAATklEQVR42mP4bx3DQAlmGLQGRALxASD+DsUHoGJEGdADxP9x4B5CBkTi0QzDkfgMOECEAQfwGfCdCAO+09QAir1AcSBSHI1USUhDLDMBAEG55IT4pendAAAAAElFTkSuQmCC'
const DOT_32 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkUlEQVR42u3WvRHAIAgFYPfKKrljJ+dwqLeHhbGwShEJkgNzFK+x4fOf1I4zWSYFIAA7Aqin9KCnjmCM0ZcAGoXaJHgD4RbPjML3ZC2ApDgbwVn2thhaAUABAClAY/bTVXgCFEVAkQCgCIAEUBUBdUuA+RaYH0Lza2j+ELl4is0/IxffsYuGxEVLFl1xAP4JuACwtZEOM4BhWgAAAABJRU5ErkJggg=='

export interface TrayActions {
  togglePause(): void
  marker(): void
  toggleDrawing(): void
  clearDrawing(): void
  toggleToolbar(): void
  restart(): void
  cancel(): void
  finish(): void
  toolbarVisible(): boolean
  drawing(): boolean
}

/**
 * Recording controls in the macOS menu bar (or the Linux system tray), so the
 * floating toolbar can stay hidden and out of the video.
 */
export class RecordingTray {
  private tray: Tray | null = null
  private status: RecStatus = { state: 'countdown', elapsedMs: 0, markerCount: 0 }
  private stamp = Date.now()
  private timer: NodeJS.Timeout | null = null
  private lastMenuKey = ''

  constructor(private readonly actions: TrayActions) {}

  show(): void {
    if (this.tray) return
    try {
      const icon = nativeImage.createFromDataURL(`data:image/png;base64,${DOT_16}`)
      icon.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${DOT_32}` })
      this.tray = new Tray(icon)
      this.tray.setToolTip('LoomLocal: grabando')
      this.refresh(true)
      this.timer = setInterval(() => this.refresh(false), 1000)
    } catch {
      // No tray available (e.g. some Linux desktops): shortcuts still work.
      this.tray = null
    }
  }

  update(status: RecStatus): void {
    this.status = status
    this.stamp = Date.now()
    this.refresh(true)
  }

  /** Rebuilds the menu after drawing/toolbar changes. */
  invalidate(): void {
    this.refresh(true)
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
    this.lastMenuKey = ''
  }

  private refresh(rebuildMenu: boolean): void {
    const tray = this.tray
    if (!tray || tray.isDestroyed()) return
    const { state } = this.status
    const elapsed = this.status.elapsedMs + (state === 'recording' ? Date.now() - this.stamp : 0)
    const label =
      state === 'countdown' ? ' Lista' : state === 'paused' ? ` ❚❚ ${formatDuration(elapsed)}` : state === 'finishing' ? ' Guardando…' : ` ${formatDuration(elapsed)}`
    if (process.platform === 'darwin') tray.setTitle(label, { fontType: 'monospacedDigit' })

    const key = `${state}|${this.status.markerCount}|${this.actions.toolbarVisible()}|${this.actions.drawing()}`
    if (!rebuildMenu && key === this.lastMenuKey) return
    this.lastMenuKey = key
    const recording = state === 'recording' || state === 'paused'
    const a = this.actions
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `LoomLocal: ${state === 'paused' ? 'en pausa' : state === 'countdown' ? 'preparando' : 'grabando'}`, enabled: false },
        { type: 'separator' },
        { label: state === 'paused' ? 'Reanudar' : 'Pausar', accelerator: 'CommandOrControl+Shift+P', enabled: recording, click: () => a.togglePause() },
        {
          label: `Agregar marcador${this.status.markerCount ? ` (${this.status.markerCount})` : ''}`,
          accelerator: 'CommandOrControl+Shift+M',
          enabled: recording,
          click: () => a.marker()
        },
        { label: a.drawing() ? 'Dejar de dibujar' : 'Dibujar', accelerator: 'CommandOrControl+Shift+D', click: () => a.toggleDrawing() },
        { label: 'Borrar trazos', accelerator: 'CommandOrControl+Shift+E', click: () => a.clearDrawing() },
        {
          label: a.toolbarVisible() ? 'Ocultar barra de controles' : 'Mostrar barra de controles',
          accelerator: 'CommandOrControl+Shift+H',
          click: () => a.toggleToolbar()
        },
        { type: 'separator' },
        { label: 'Reiniciar grabación…', enabled: recording, click: () => a.restart() },
        { label: 'Cancelar grabación…', click: () => a.cancel() },
        { type: 'separator' },
        { label: 'Terminar y guardar', accelerator: 'CommandOrControl+Shift+S', enabled: recording, click: () => a.finish() }
      ])
    )
  }
}
