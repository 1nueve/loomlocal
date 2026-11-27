import { useEffect, useRef, useState } from 'react'
import type { DrawState, Settings } from '../../../shared/types'

const api = window.api

interface Point {
  x: number
  y: number
}

interface Shape {
  tool: DrawState['tool']
  color: string
  points: Point[]
  /** performance.now() when the stroke was finished; undefined while drawing. */
  doneAt?: number
}

interface Ripple {
  id: number
  x: number
  y: number
}

const FADE_AFTER = 3000
const FADE_FOR = 600

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, alpha: number): void {
  const pts = s.points
  if (pts.length === 0) return
  ctx.save()
  ctx.globalAlpha = alpha * (s.tool === 'highlighter' ? 0.35 : 1)
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = s.tool === 'highlighter' ? 22 : 5
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = s.tool === 'highlighter' ? 0 : 4
  const a = pts[0]
  const b = pts[pts.length - 1]
  if (s.tool === 'pen' || s.tool === 'highlighter') {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  } else if (s.tool === 'rect') {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  } else if (s.tool === 'arrow') {
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const head = 22
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x - Math.cos(angle) * head * 0.6, b.y - Math.sin(angle) * head * 0.6)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Transparent full-screen layer over the recorded display: countdown, cursor
 * halo, click ripples and the drawing canvas. It is part of the recording.
 */
export function Overlay() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const shapes = useRef<Shape[]>([])
  const current = useRef<Shape | null>(null)
  const fade = useRef(true)
  const raf = useRef(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const [draw, setDraw] = useState<DrawState>({ enabled: false, tool: 'pen', color: '#ff3b5c' })

  // Render loop: runs only while there is something to draw or fade.
  const kick = () => {
    if (raf.current) return
    const frame = () => {
      raf.current = 0
      const c = canvas.current
      if (!c) return
      const ctx = c.getContext('2d')!
      const now = performance.now()
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.save()
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      shapes.current = shapes.current.filter((s) => !fade.current || !s.doneAt || now - s.doneAt < FADE_AFTER + FADE_FOR)
      for (const s of shapes.current) {
        const age = s.doneAt ? now - s.doneAt : 0
        const alpha = fade.current && s.doneAt && age > FADE_AFTER ? 1 - (age - FADE_AFTER) / FADE_FOR : 1
        drawShape(ctx, s, Math.max(0, alpha))
      }
      if (current.current) drawShape(ctx, current.current, 1)
      ctx.restore()
      if (current.current || (fade.current && shapes.current.length)) raf.current = requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
  }

  useEffect(() => {
    const resize = () => {
      const c = canvas.current
      if (!c) return
      c.width = window.innerWidth * window.devicePixelRatio
      c.height = window.innerHeight * window.devicePixelRatio
      kick()
    }
    resize()
    window.addEventListener('resize', resize)
    void api.getSettings().then((s) => (fade.current = s.drawFade))
    void api.overlayInit().then((init) => {
      setDraw(init.drawing)
      if (init.countdown !== null) setCountdown((c) => c ?? init.countdown)
    })
    const offs = [
      api.on('settings:changed', (s) => (fade.current = (s as Settings).drawFade)),
      api.on('overlay:countdown', (p) => setCountdown(p ? (p as { seconds: number }).seconds : null)),
      api.on('overlay:pointer', (p) => setPointer(p as Point | null)),
      api.on('overlay:click', (p) => {
        const id = Math.random()
        setRipples((r) => [...r, { id, ...(p as Point) }])
        setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 650)
      }),
      api.on('overlay:drawing', (s) => setDraw(s as DrawState)),
      api.on('overlay:clear', () => {
        shapes.current = []
        current.current = null
        kick()
      })
    ]
    return () => {
      window.removeEventListener('resize', resize)
      offs.forEach((o) => o())
    }
  }, [])

  // Countdown ticks; click or Esc skips it.
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      setCountdown(null)
      api.countdownDone()
      return
    }
    const t = setTimeout(() => setCountdown((n) => (n === null ? null : n - 1)), 1000)
    const skip = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setCountdown(0)
    }
    window.addEventListener('keydown', skip)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', skip)
    }
  }, [countdown])

  const local = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })

  return (
    <div className={`overlay ${draw.enabled ? 'drawing' : ''}`}>
      <canvas
        ref={canvas}
        className="draw-canvas"
        onPointerDown={(e) => {
          if (!draw.enabled) return
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          current.current = { tool: draw.tool, color: draw.color, points: [local(e)] }
          kick()
        }}
        onPointerMove={(e) => {
          const s = current.current
          if (!s) return
          const p = local(e)
          if (s.tool === 'arrow' || s.tool === 'rect') s.points = [s.points[0], p]
          else s.points.push(p)
          kick()
        }}
        onPointerUp={() => {
          const s = current.current
          if (!s) return
          s.doneAt = performance.now()
          shapes.current.push(s)
          current.current = null
          kick()
        }}
      />
      {pointer && countdown === null && <div className="cursor-halo" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }} />}
      {ripples.map((r) => (
        <div key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
      ))}
      {countdown !== null && countdown > 0 && (
        <div className="countdown" onClick={() => setCountdown(0)}>
          <div className="countdown-num" key={countdown}>{countdown}</div>
          <p>Haz clic o pulsa Esc para empezar ya</p>
        </div>
      )}
    </div>
  )
}
