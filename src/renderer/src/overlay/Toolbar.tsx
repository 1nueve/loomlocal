import { useEffect, useState } from 'react'
import { formatDuration } from '../../../shared/vtt'
import type { DrawState, DrawTool, DrawWidth, RecStatus } from '../../../shared/types'

const api = window.api

const TOOLS: Array<{ id: DrawTool; label: string; icon: string }> = [
  { id: 'pen', label: 'Pluma', icon: '✒' },
  { id: 'highlighter', label: 'Resaltador', icon: '▬' },
  { id: 'arrow', label: 'Flecha', icon: '➜' },
  { id: 'rect', label: 'Rectángulo', icon: '▭' }
]
const COLORS = ['#ff3b5c', '#ffd60a', '#30d158', '#0a84ff', '#ffffff']
const WIDTHS: Array<{ id: DrawWidth; label: string; dot: number }> = [
  { id: 'fino', label: 'Fino', dot: 4 },
  { id: 'medio', label: 'Medio', dot: 7 },
  { id: 'grueso', label: 'Grueso', dot: 11 }
]

/** Floating controls. Excluded from the capture on macOS via content protection. */
export function Toolbar() {
  const [status, setStatus] = useState<RecStatus>({ state: 'countdown', elapsedMs: 0, markerCount: 0 })
  const [stamp, setStamp] = useState(performance.now())
  const [, tick] = useState(0)
  const [draw, setDraw] = useState<DrawState>({ enabled: false, tool: 'pen', color: COLORS[0], width: 'medio' })

  useEffect(() => {
    const offs = [
      api.on('rec:state', (s) => {
        setStatus(s as RecStatus)
        setStamp(performance.now())
      }),
      api.on('overlay:drawing', (s) => setDraw(s as DrawState))
    ]
    void api.overlayInit().then((init) => setDraw(init.drawing))
    void api.recStatus().then((s) => {
      setStatus(s)
      setStamp(performance.now())
    })
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => {
      offs.forEach((o) => o())
      clearInterval(t)
    }
  }, [])

  const elapsed = status.elapsedMs + (status.state === 'recording' ? performance.now() - stamp : 0)
  const recording = status.state === 'recording' || status.state === 'paused'
  const updateDraw = (patch: Partial<DrawState>) => {
    const next = { ...draw, ...patch }
    setDraw(next)
    api.setDrawing(next)
  }

  return (
    <div className="toolbar">
      <div className="grip" title="Arrastrar" />
      <span className={`rec-dot ${status.state}`} />
      <span className="timer">{status.state === 'countdown' ? 'Lista' : formatDuration(elapsed)}</span>
      <button
        className="tb"
        disabled={!recording}
        onClick={() => api.recCommand({ type: status.state === 'paused' ? 'resume' : 'pause' })}
        title="Pausar o reanudar"
      >
        {status.state === 'paused' ? '▶' : '❚❚'}
      </button>
      <button className="tb" disabled={!recording} onClick={() => api.recCommand({ type: 'marker' })} title="Agregar marcador">
        ⚑{status.markerCount > 0 && <sup>{status.markerCount}</sup>}
      </button>
      <span className="sep" />
      <button className={`tb ${draw.enabled ? 'on' : ''}`} onClick={() => updateDraw({ enabled: !draw.enabled })} title="Dibujar">✎</button>
      {draw.enabled && (
        <>
          {TOOLS.map((t) => (
            <button key={t.id} className={`tb small ${draw.tool === t.id ? 'on' : ''}`} onClick={() => updateDraw({ tool: t.id })} title={t.label}>
              {t.icon}
            </button>
          ))}
          <span className="sep" />
          {WIDTHS.map((w) => (
            <button
              key={w.id}
              className={`tb small width ${draw.width === w.id ? 'on' : ''}`}
              onClick={() => updateDraw({ width: w.id })}
              title={`Grosor ${w.label.toLowerCase()}`}
              aria-label={`Grosor ${w.label.toLowerCase()}`}
            >
              <span className="width-dot" style={{ width: w.dot, height: w.dot, background: draw.color }} />
            </button>
          ))}
          <span className="sep" />
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${draw.color === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => updateDraw({ color: c })}
              title="Color"
            />
          ))}
        </>
      )}
      <button className="tb small" onClick={() => api.clearDrawing()} title="Borrar trazos">⌫</button>
      <button className="tb small" onClick={() => api.hideToolbar()} title="Ocultar esta barra (⌘⇧H para volver a mostrarla)">
        ⌄
      </button>
      <span className="sep" />
      <button
        className="tb"
        disabled={status.state === 'finishing'}
        onClick={() => confirm('¿Reiniciar? Se borrará lo grabado.') && api.recCommand({ type: 'restart' })}
        title="Reiniciar"
      >
        ↺
      </button>
      <button
        className="tb"
        disabled={status.state === 'finishing'}
        onClick={() => confirm('¿Cancelar y borrar esta grabación?') && api.recCommand({ type: 'cancel' })}
        title="Cancelar"
      >
        🗑
      </button>
      <button className="finish" disabled={!recording} onClick={() => api.recCommand({ type: 'finish' })}>
        {status.state === 'finishing' ? 'Guardando…' : 'Terminar'}
      </button>
    </div>
  )
}
