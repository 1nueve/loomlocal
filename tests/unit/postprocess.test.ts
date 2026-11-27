import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveFfmpeg } from '../../src/main/ffmpeg'
import { extractWav, finalizeWebm, hasAudio, makeThumbnail, toMp4 } from '../../src/main/postprocess'

const ffmpeg = resolveFfmpeg()
let available = true
try {
  execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' })
} catch {
  available = false
}
const dir = mkdtempSync(join(tmpdir(), 'loomlocal-pp-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!available)('postprocess (ffmpeg)', () => {
  const part = join(dir, 'rec.webm.part')
  const webm = join(dir, 'rec.webm')

  it('finalizes a MediaRecorder-like WebM, thumbnails it and converts to MP4', async () => {
    // A 2 s VP8/Opus WebM similar to what MediaRecorder writes.
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', '-f', 'webm', part
    ])
    await finalizeWebm(ffmpeg, part, webm)
    expect(statSync(webm).size).toBeGreaterThan(1000)
    expect(await hasAudio(ffmpeg, webm)).toBe(true)

    const thumb = join(dir, 'rec.jpg')
    await makeThumbnail(ffmpeg, webm, thumb, 2000)
    expect(existsSync(thumb)).toBe(true)

    const mp4 = join(dir, 'rec.mp4')
    await toMp4(ffmpeg, webm, mp4)
    expect(statSync(mp4).size).toBeGreaterThan(1000)

    const wav = join(dir, 'rec.wav')
    await extractWav(ffmpeg, mp4, wav)
    // 2 s × 16 kHz × 2 bytes ≈ 64 KB
    expect(statSync(wav).size).toBeGreaterThan(50_000)
  })

  it('falls back to the raw file when ffmpeg cannot parse it', async () => {
    const junk = join(dir, 'junk.webm.part')
    require('node:fs').writeFileSync(junk, 'not a video')
    const out = join(dir, 'junk.webm')
    await finalizeWebm(ffmpeg, junk, out)
    expect(existsSync(out)).toBe(true)
  })
})
