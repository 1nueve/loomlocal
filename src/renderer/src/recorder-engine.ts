import type { Marker, RecCommand, RecordingOptions, RecState } from '../../shared/types'

const api = window.api

type EndReason = 'finish' | 'restart' | 'cancel'

function pickMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

/**
 * Owns the capture streams and the MediaRecorder. Lives in the main window's
 * renderer (kept alive while the window is hidden) and is driven by commands
 * relayed from the floating toolbar or global shortcuts.
 */
class RecorderEngine {
  private display: MediaStream | null = null
  private inputs: MediaStream[] = []
  private ctx: AudioContext | null = null
  private mixed: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chain: Promise<void> = Promise.resolve()
  private markers: Marker[] = []
  private accumulated = 0
  private segmentStart = 0
  private state: RecState = 'idle'
  private ending: EndReason | null = null
  private unsubscribe: Array<() => void> = []

  get busy(): boolean {
    return this.state !== 'idle'
  }

  async start(opts: RecordingOptions): Promise<void> {
    if (this.busy) return
    this.state = 'countdown'
    try {
      await api.recSelect(opts)
      const wantsLoopback = opts.systemAudio && api.platform !== 'linux'
      const video = { frameRate: { ideal: 30, max: 30 } }
      try {
        this.display = await navigator.mediaDevices.getDisplayMedia({ video, audio: wantsLoopback })
      } catch (err) {
        if (!wantsLoopback) throw err
        // System audio is best effort; record without it rather than fail.
        this.display = await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
      }

      if (opts.micId) {
        this.inputs.push(
          await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: opts.micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          })
        )
      }
      if (api.platform === 'linux' && opts.systemAudio && opts.systemAudioDeviceId) {
        try {
          this.inputs.push(
            await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { exact: opts.systemAudioDeviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              }
            })
          )
        } catch {
          // monitor input unavailable: continue without system audio
        }
      }

      const audioTracks = [...this.display.getAudioTracks(), ...this.inputs.flatMap((s) => s.getAudioTracks())]
      const tracks: MediaStreamTrack[] = [...this.display.getVideoTracks()]
      if (audioTracks.length) {
        this.ctx = new AudioContext()
        const dest = this.ctx.createMediaStreamDestination()
        for (const t of audioTracks) this.ctx.createMediaStreamSource(new MediaStream([t])).connect(dest)
        tracks.push(...dest.stream.getAudioTracks())
      }
      this.mixed = new MediaStream(tracks)

      // The user stopped sharing from the OS (e.g. the Linux portal indicator).
      const vt = this.display.getVideoTracks()[0]
      if (vt) vt.onended = () => this.command({ type: 'finish' })

      this.unsubscribe.push(
        api.on('rec:go', () => this.go()),
        api.on('rec:command', (cmd) => this.command(cmd as RecCommand))
      )
      this.markers = []
      this.publish()
      await api.recPrepare()
    } catch (err) {
      this.cleanup()
      await api.recCancel()
      throw err
    }
  }

  private elapsed(): number {
    return this.accumulated + (this.state === 'recording' ? performance.now() - this.segmentStart : 0)
  }

  private publish(): void {
    api.recState({ state: this.state, elapsedMs: Math.round(this.elapsed()), markerCount: this.markers.length })
  }

  private go(): void {
    if (!this.mixed || this.recorder) return
    const mimeType = pickMime()
    const rec = new MediaRecorder(this.mixed, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000
    })
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      const blob = e.data
      // Keep chunk order: each write waits for the previous one.
      this.chain = this.chain.then(async () => {
        if (this.ending === 'restart' || this.ending === 'cancel') return
        await api.recChunk(await blob.arrayBuffer())
      })
    }
    rec.onstop = () => void this.onStop()
    this.recorder = rec
    this.accumulated = 0
    this.segmentStart = performance.now()
    this.state = 'recording'
    rec.start(1000)
    this.publish()
  }

  command(cmd: RecCommand): void {
    const rec = this.recorder
    switch (cmd.type) {
      case 'toggle-pause':
        return this.command(this.state === 'paused' ? { type: 'resume' } : { type: 'pause' })
      case 'pause':
        if (rec && this.state === 'recording') {
          rec.pause()
          this.accumulated = this.elapsed()
          this.state = 'paused'
          this.publish()
        }
        return
      case 'resume':
        if (rec && this.state === 'paused') {
          rec.resume()
          this.segmentStart = performance.now()
          this.state = 'recording'
          this.publish()
        }
        return
      case 'marker':
        if (rec && (this.state === 'recording' || this.state === 'paused')) {
          this.markers.push({ t: Math.round(this.elapsed()), label: `Marcador ${this.markers.length + 1}` })
          this.publish()
        }
        return
      case 'restart':
      case 'cancel':
      case 'finish':
        if (this.ending) return
        if (!rec) {
          // Still in the countdown: nothing recorded yet.
          if (cmd.type !== 'restart') void this.abort()
          return
        }
        this.ending = cmd.type
        this.accumulated = this.elapsed()
        this.state = 'finishing'
        this.publish()
        rec.stop()
        return
    }
  }

  private async abort(): Promise<void> {
    this.cleanup()
    await api.recCancel()
  }

  private async onStop(): Promise<void> {
    const reason = this.ending
    const durationMs = Math.round(this.accumulated)
    await this.chain
    this.recorder = null
    this.ending = null
    if (reason === 'restart') {
      await api.recDiscard()
      this.markers = []
      this.accumulated = 0
      this.state = 'countdown'
      this.publish()
      await api.recPrepare()
      return
    }
    const markers = this.markers
    this.cleanup()
    if (reason === 'cancel') {
      await api.recCancel()
    } else {
      await api.recFinish({ durationMs, markers })
    }
  }

  private cleanup(): void {
    this.unsubscribe.forEach((u) => u())
    this.unsubscribe = []
    for (const s of [this.display, this.mixed, ...this.inputs]) s?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.display = null
    this.mixed = null
    this.inputs = []
    this.ctx = null
    this.recorder = null
    this.ending = null
    this.accumulated = 0
    this.state = 'idle'
  }
}

export const engine = new RecorderEngine()
