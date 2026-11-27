import { useEffect, useRef, useState } from 'react'
import type { BubbleShape, Settings } from '../../../shared/types'

const api = window.api

const SHAPES: Array<{ id: BubbleShape; icon: string; label: string }> = [
  { id: 'circle', icon: '○', label: 'Círculo' },
  { id: 'rounded', icon: '▢', label: 'Cuadrado' },
  { id: 'rect', icon: '▯', label: 'Rectángulo vertical (9:16)' }
]

/**
 * Speaking level from the microphone, 0..1: RMS in dB mapped from -60..-15,
 * rising fast and falling slowly so the ring follows the rhythm of the voice.
 */
function useVoiceRing(micId: string | null, enabled: boolean, ring: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ring.current
    if (!el) return
    el.style.opacity = '0'
    if (!micId || !enabled) return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let cancelled = false
    let level = 0
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: micId }, noiseSuppression: true, echoCancellation: false, autoGainControl: false }
        })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const tick = () => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += v * v
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8)
          const target = Math.min(1, Math.max(0, (db + 60) / 45))
          level += (target - level) * (target > level ? 0.5 : 0.08)
          el.style.opacity = (0.15 + 0.85 * level).toFixed(3)
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // No mic access: show a faint static ring instead.
        el.style.opacity = '0.15'
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [micId, enabled, ring])
}

/** Floating, draggable, resizable camera bubble. It is captured as part of the screen. */
export function Bubble({ cameraId, micId }: { cameraId: string; micId: string | null }) {
  const video = useRef<HTMLVideoElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const [shape, setShape] = useState<BubbleShape>('circle')
  const [voiceRing, setVoiceRing] = useState(true)
  const [error, setError] = useState(false)
  const drag = useRef<{ offset: number; raf: number; width: number } | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
      })
      .catch(() => setError(true))
    const apply = (s: Settings) => {
      setShape(s.bubbleShape)
      setVoiceRing(s.bubbleVoiceRing)
    }
    void api.getSettings().then(apply)
    const off = api.on('settings:changed', (s) => apply(s as Settings))
    return () => {
      cancelled = true
      off()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraId])

  useVoiceRing(micId, voiceRing, ring)

  // Resize from the top-right handle. The window keeps its bottom-left corner,
  // so its left edge never moves and clientX is a stable reference.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { offset: window.innerWidth - e.clientX, raf: 0, width: window.innerWidth }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.width = Math.round(e.clientX + d.offset)
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        if (drag.current) {
          drag.current.raf = 0
          api.bubbleResizeTo(drag.current.width)
        }
      })
    }
  }
  const onResizeEnd = () => {
    const d = drag.current
    if (d) api.bubbleResizeTo(d.width)
    drag.current = null
  }

  return (
    <div className={`bubble ${shape}`}>
      {error ? <div className="bubble-error">Cámara no disponible</div> : <video ref={video} autoPlay muted playsInline />}
      <div ref={ring} className="bubble-ring" aria-hidden />
      <div className="bubble-controls">
        {(['s', 'm', 'l'] as const).map((s) => (
          <button key={s} onClick={() => api.bubbleResize(s)} title={`Tamaño ${s.toUpperCase()}`}>
            {s.toUpperCase()}
          </button>
        ))}
        <span className="bubble-sep" />
        {SHAPES.map((s) => (
          <button key={s.id} className={shape === s.id ? 'on' : ''} onClick={() => api.bubbleShape(s.id)} title={s.label}>
            {s.icon}
          </button>
        ))}
      </div>
      <div
        className="bubble-resize"
        title="Arrastra para cambiar el tamaño"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </div>
  )
}
