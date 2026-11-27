import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveFfmpeg } from '../../src/main/ffmpeg'
import { LibraryService, libraryDirs } from '../../src/main/library-service'
import { DEFAULT_SETTINGS, type Settings, type Video } from '../../src/shared/types'

const ffmpeg = resolveFfmpeg()
let available = true
try {
  execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' })
} catch {
  available = false
}
const root = mkdtempSync(join(tmpdir(), 'loomlocal-lib-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Stand-in for whisper-cli: writes <-of>.vtt and <-of>.txt like whisper.cpp does. */
function fakeWhisper(): string {
  const bin = join(root, 'fake-whisper')
  writeFileSync(
    bin,
    `#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in -of) shift; OUT="$1";; esac; shift; done
printf 'WEBVTT\\n\\n00:00:00.000 --> 00:00:01.500\\n Hola mundo\\n' > "$OUT.vtt"
printf 'Hola mundo\\n' > "$OUT.txt"
`
  )
  chmodSync(bin, 0o755)
  return bin
}

function waitFor(svc: LibraryService, id: string, pred: (v: Video) => boolean): Promise<Video> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(svc.store.get(id))}`)), 30_000)
    const check = () => {
      const v = svc.store.get(id)
      if (v && pred(v)) {
        clearTimeout(timer)
        svc.off('changed', check)
        resolve(v)
      }
    }
    svc.on('changed', check)
    check()
  })
}

describe.skipIf(!available || process.platform === 'win32')('LibraryService', () => {
  const model = join(root, 'ggml-fake.bin')
  writeFileSync(model, 'model')
  const settings: Settings = { ...DEFAULT_SETTINGS, whisperBin: fakeWhisper(), whisperModel: model }
  const dirs = libraryDirs(join(root, 'data'))
  const svc = new LibraryService(dirs, ffmpeg, () => settings)

  it('ingests a recording: webm → thumbnail → mp4 → transcript', async () => {
    const id = 'test-rec-1'
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libvpx', '-c:a', 'libopus', '-f', 'webm', svc.partPath(id)
    ])
    await svc.ingest(id, 2000, [{ t: 1200, label: 'B' }, { t: 300, label: 'A' }])
    const v = await waitFor(svc, id, (x) => x.transcript.status === 'done')
    expect(v.status).toBe('ready')
    expect(v.file).toBe(`${id}.mp4`)
    expect(v.mime).toBe('video/mp4')
    expect(v.thumb).toBe(`${id}.jpg`)
    expect(v.markers.map((m) => m.label)).toEqual(['A', 'B'])
    expect(v.transcript.text).toBe('Hola mundo')
    expect(existsSync(join(dirs.captions, `${id}.vtt`))).toBe(true)
    expect(existsSync(svc.partPath(id))).toBe(false)
    expect(existsSync(join(dirs.videos, `${id}.webm`))).toBe(false)

    svc.update(id, { title: '  Nuevo título  ', markers: [{ t: -5, label: 'x' }, { t: 10.4, label: 'ok' }] })
    expect(svc.store.get(id)?.title).toBe('Nuevo título')
    expect(svc.store.get(id)?.markers).toEqual([{ t: 10, label: 'ok' }])

    svc.delete(id)
    expect(svc.store.get(id)).toBeNull()
    expect(existsSync(join(dirs.videos, `${id}.mp4`))).toBe(false)
    expect(existsSync(join(dirs.captions, `${id}.vtt`))).toBe(false)
  })

  it('marks empty recordings as errors and reports a missing whisper', async () => {
    const id = 'test-empty'
    writeFileSync(svc.partPath(id), '')
    await svc.ingest(id, 0, [])
    const v = await waitFor(svc, id, (x) => x.status === 'error')
    expect(v.error).toMatch(/vacía/)

    const other = new LibraryService(libraryDirs(join(root, 'data2')), ffmpeg, () => ({ ...DEFAULT_SETTINGS, whisperBin: 'definitely-not-installed' }))
    other.store.add({ ...v, id: 'w', status: 'ready', file: 'w.mp4' })
    other.enqueueTranscription('w')
    expect(other.store.get('w')?.transcript.status).toBe('unavailable')
    expect(other.store.get('w')?.transcript.error).toMatch(/whisper-cpp/)
  })
})

describe.skipIf(!available)('LibraryService crash recovery', () => {
  it('ingests leftover .webm.part files and measures their duration', async () => {
    const dirs = libraryDirs(join(root, 'data3'))
    const svc = new LibraryService(dirs, ffmpeg, () => ({ ...DEFAULT_SETTINGS, convertToMp4: false, whisperEnabled: false }))
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=3',
      '-c:v', 'libvpx', '-f', 'webm', svc.partPath('crashed')
    ])
    writeFileSync(svc.partPath('empty'), '')
    expect(svc.recoverOrphans()).toEqual(['crashed'])
    const v = await waitFor(svc, 'crashed', (x) => x.status === 'ready')
    expect(v.title).toMatch(/^Grabación recuperada/)
    expect(v.durationMs).toBeGreaterThan(2500)
    expect(svc.recoverOrphans()).toEqual([])
  })
})
