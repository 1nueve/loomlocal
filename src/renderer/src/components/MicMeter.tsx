import { useEffect, useRef, useState } from 'react'

/**
 * Live input level for the selected microphone: mic → low-pass → gain →
 * analyser, the same chain observed in the Loom SDK. Warns after a few seconds
 * of silence so a muted or wrong mic is caught before recording.
 */
export function MicMeter({ deviceId }: { deviceId: string | null }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [silent, setSilent] = useState(false)

  useEffect(() => {
    setSilent(false)
    if (!deviceId) return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let cancelled = false
    let quietSince = performance.now()

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.minDecibels = -90
        analyser.maxDecibels = -10
        const lowpass = ctx.createBiquadFilter()
        lowpass.type = 'lowpass'
        lowpass.frequency.value = 8000
        const gain = ctx.createGain()
        gain.gain.value = 1.5
        ctx.createMediaStreamSource(stream).connect(lowpass)
        lowpass.connect(gain)
        gain.connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const tick = () => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += v * v
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8)
          const level = Math.min(1, Math.max(0, (db + 60) / 50))
          if (barRef.current) barRef.current.style.transform = `scaleX(${level})`
          const now = performance.now()
          if (db > -55) quietSince = now
          setSilent(now - quietSince > 4000)
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        setSilent(true)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId])

  if (!deviceId) return null
  return (
    <div className="meter">
      <div className="meter-track">
        <div ref={barRef} className="meter-bar" />
      </div>
      {silent && <span className="meter-warn">No detectamos sonido en este micrófono.</span>}
    </div>
  )
}
