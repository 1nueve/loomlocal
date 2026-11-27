import { useEffect, useRef, useState } from 'react'

/**
 * Live input level for the selected microphone: mic → low-pass → gain →
 * analyser, the same chain observed in the Loom SDK. Warns after a few seconds
 * of silence so a muted or wrong mic is caught before recording.
 */
export function MicMeter({ deviceId }: { deviceId: string | null }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [silent, setSilent] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    setSilent(false)
    setBlocked(false)
    if (!deviceId) return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let cancelled = false
    let quietSince = performance.now()

    void (async () => {
      try {
        // Raw input for metering: noise suppression would flatten a quiet room
        // to near silence and trigger a false "no sound" warning.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        })
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
          if (db > -65) quietSince = now
          setSilent(now - quietSince > 6000)
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        setBlocked(true)
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
      {blocked && <span className="meter-warn">Sin acceso al micrófono. Revisa el permiso en Ajustes del Sistema.</span>}
      {!blocked && silent && <span className="meter-hint">No oímos nada todavía. Habla para probar el micrófono.</span>}
    </div>
  )
}
