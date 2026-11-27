import { useEffect, useRef, useState } from 'react'
import type { BubbleShape, BubbleSize, Settings } from '../../../shared/types'

const api = window.api

/** Floating, draggable camera bubble. It is captured as part of the screen. */
export function Bubble({ cameraId, initialShape }: { cameraId: string; initialShape: BubbleShape }) {
  const video = useRef<HTMLVideoElement>(null)
  const [shape, setShape] = useState<BubbleShape>(initialShape)
  const [error, setError] = useState(false)

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
    const off = api.on('settings:changed', (s) => setShape((s as Settings).bubbleShape))
    return () => {
      cancelled = true
      off()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraId])

  const resize = (s: BubbleSize) => api.bubbleResize(s)

  return (
    <div className={`bubble ${shape}`}>
      {error ? <div className="bubble-error">Cámara no disponible</div> : <video ref={video} autoPlay muted playsInline />}
      <div className="bubble-controls">
        {(['s', 'm', 'l'] as const).map((s) => (
          <button key={s} onClick={() => resize(s)} title={`Tamaño ${s.toUpperCase()}`}>{s.toUpperCase()}</button>
        ))}
        <button onClick={() => api.bubbleShape()} title="Cambiar forma">{shape === 'circle' ? '▢' : '○'}</button>
      </div>
    </div>
  )
}
