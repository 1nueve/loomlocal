import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Marker, Settings, Video, VideoPatch } from '../shared/types'
import { extractWav, finalizeWebm, hasAudio, makeThumbnail, probeDurationMs, toMp4 } from './postprocess'
import { LibraryStore, newToken } from './store'
import { checkWhisper, runWhisper, summarizeWithOllama } from './transcribe'

export interface LibraryDirs {
  root: string
  videos: string
  thumbs: string
  captions: string
}

export function libraryDirs(root: string): LibraryDirs {
  const dirs = {
    root,
    videos: join(root, 'videos'),
    thumbs: join(root, 'thumbs'),
    captions: join(root, 'captions')
  }
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  return dirs
}

function defaultTitle(d: Date): string {
  return `Grabación del ${d.toLocaleDateString('es', { day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Owns the video library: ingesting finished recordings, post-processing with
 * ffmpeg, the transcription queue, edits and deletion. Emits "changed".
 */
export class LibraryService extends EventEmitter {
  readonly store: LibraryStore
  private queue: Promise<void> = Promise.resolve()

  constructor(
    readonly dirs: LibraryDirs,
    private readonly ffmpeg: string,
    private readonly settings: () => Settings
  ) {
    super()
    this.store = new LibraryStore(join(dirs.root, 'library.json'))
    // Recordings interrupted by a crash are recovered as processing jobs.
    for (const v of this.store.list()) {
      if (v.status !== 'processing') continue
      // If the raw recording is still there, recoverOrphans() reprocesses it.
      if (existsSync(this.partPath(v.id))) this.store.remove(v.id)
      else this.store.update(v.id, { status: 'error', error: 'Procesamiento interrumpido.' })
    }
  }

  partPath(id: string): string {
    return join(this.dirs.videos, `${id}.webm.part`)
  }

  private changed(id?: string): void {
    this.emit('changed', id)
  }

  /**
   * Recordings whose app crashed before "Terminar" leave a `.webm.part` file
   * behind. Ingest them so the footage is not lost. Call only at startup.
   */
  recoverOrphans(): string[] {
    const recovered: string[] = []
    for (const name of readdirSync(this.dirs.videos)) {
      if (!name.endsWith('.webm.part')) continue
      const id = name.slice(0, -'.webm.part'.length)
      if (this.store.get(id) || statSync(join(this.dirs.videos, name)).size === 0) continue
      void this.ingest(id, 0, [], 'Grabación recuperada')
      recovered.push(id)
    }
    return recovered
  }

  /** Called with a finished `.webm.part` file written chunk by chunk. */
  async ingest(id: string, durationMs: number, markers: Marker[], titlePrefix?: string): Promise<Video> {
    const now = new Date()
    const video = this.store.add({
      id,
      title: titlePrefix ? `${titlePrefix} (${now.toLocaleString('es')})` : defaultTitle(now),
      createdAt: now.toISOString(),
      durationMs,
      file: `${id}.webm.part`,
      mime: 'video/webm',
      sizeBytes: 0,
      status: 'processing',
      markers: [...markers].sort((a, b) => a.t - b.t),
      transcript: { status: 'none' },
      shareToken: newToken()
    })
    this.changed(id)
    void this.process(id)
    return video
  }

  private async process(id: string): Promise<void> {
    const part = this.partPath(id)
    const webm = join(this.dirs.videos, `${id}.webm`)
    try {
      if (!existsSync(part) || statSync(part).size === 0) throw new Error('La grabación está vacía.')
      await finalizeWebm(this.ffmpeg, part, webm)
      if (existsSync(part)) unlinkSync(part)
      let v = this.store.get(id)!
      if (!v.durationMs) v = this.store.update(id, { durationMs: await probeDurationMs(this.ffmpeg, webm) })!
      const thumb = `${id}.jpg`
      try {
        await makeThumbnail(this.ffmpeg, webm, join(this.dirs.thumbs, thumb), v.durationMs)
      } catch {
        // a missing thumbnail is not fatal
      }
      this.store.update(id, {
        status: 'ready',
        file: `${id}.webm`,
        mime: 'video/webm',
        sizeBytes: statSync(webm).size,
        thumb: existsSync(join(this.dirs.thumbs, thumb)) ? thumb : undefined,
        converting: this.settings().convertToMp4
      })
      this.changed(id)
    } catch (err) {
      this.store.update(id, { status: 'error', error: (err as Error).message })
      this.changed(id)
      return
    }

    if (this.settings().convertToMp4) {
      const mp4 = join(this.dirs.videos, `${id}.mp4`)
      try {
        await toMp4(this.ffmpeg, webm, mp4)
        this.store.update(id, { file: `${id}.mp4`, mime: 'video/mp4', sizeBytes: statSync(mp4).size, converting: false })
        unlinkSync(webm)
      } catch (err) {
        if (existsSync(mp4)) unlinkSync(mp4)
        this.store.update(id, { converting: false, error: `Se conserva el WebM. ${(err as Error).message}` })
      }
      this.changed(id)
    }
    this.enqueueTranscription(id)
  }

  enqueueTranscription(id: string): void {
    const s = this.settings()
    const check = checkWhisper(s)
    if (!check.ok) {
      this.store.update(id, { transcript: { status: 'unavailable', error: check.message } })
      this.changed(id)
      return
    }
    this.store.update(id, { transcript: { status: 'pending' } })
    this.changed(id)
    this.queue = this.queue.then(() => this.transcribe(id)).catch(() => undefined)
  }

  private async transcribe(id: string): Promise<void> {
    const v = this.store.get(id)
    if (!v) return
    const input = join(this.dirs.videos, v.file)
    this.store.update(id, { transcript: { status: 'running' } })
    this.changed(id)
    const work = join(tmpdir(), `loomlocal-${id}`)
    mkdirSync(work, { recursive: true })
    try {
      if (!(await hasAudio(this.ffmpeg, input))) {
        this.store.update(id, { transcript: { status: 'unavailable', error: 'El video no tiene audio.' } })
        return
      }
      const wav = join(work, 'audio.wav')
      await extractWav(this.ffmpeg, input, wav)
      const outBase = join(this.dirs.captions, id)
      const { text } = await runWhisper(this.settings(), wav, outBase)
      this.store.update(id, { transcript: { status: 'done', text, vttFile: `${id}.vtt` } })
      this.changed(id)
      const s = this.settings()
      if (s.ollamaEnabled && text) {
        try {
          const { title, summary } = await summarizeWithOllama(s, text)
          const current = this.store.get(id)
          const patch: Partial<Video> = {}
          // Only replace the title if the user has not renamed it yet.
          if (title && current && current.title === defaultTitle(new Date(current.createdAt))) patch.title = title
          if (summary) patch.summary = summary
          this.store.update(id, patch)
        } catch {
          // Ollama is optional
        }
      }
    } catch (err) {
      this.store.update(id, { transcript: { status: 'error', error: (err as Error).message } })
    } finally {
      rmSync(work, { recursive: true, force: true })
      this.changed(id)
    }
  }

  update(id: string, patch: VideoPatch): Video | null {
    const clean: Partial<Video> = {}
    if (typeof patch.title === 'string') clean.title = patch.title.trim().slice(0, 200) || 'Sin título'
    if (Array.isArray(patch.markers)) {
      clean.markers = patch.markers
        .filter((m) => Number.isFinite(m.t) && m.t >= 0)
        .map((m) => ({ t: Math.round(m.t), label: String(m.label ?? '').slice(0, 200) }))
        .sort((a, b) => a.t - b.t)
    }
    const v = this.store.update(id, clean)
    this.changed(id)
    return v
  }

  delete(id: string): void {
    const v = this.store.remove(id)
    if (!v) return
    const files = [
      join(this.dirs.videos, v.file),
      join(this.dirs.videos, `${id}.webm`),
      join(this.dirs.videos, `${id}.mp4`),
      this.partPath(id),
      v.thumb ? join(this.dirs.thumbs, v.thumb) : '',
      join(this.dirs.captions, `${id}.vtt`),
      join(this.dirs.captions, `${id}.txt`)
    ]
    for (const f of files) if (f) rmSync(f, { force: true })
    this.changed(id)
  }

  videoPath(id: string): string | null {
    const v = this.store.get(id)
    return v ? join(this.dirs.videos, v.file) : null
  }
}
