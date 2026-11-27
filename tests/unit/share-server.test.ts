import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ShareServer } from '../../src/main/share-server'
import type { Video } from '../../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'loomlocal-share-'))
const dirs = { videos: join(root, 'videos'), thumbs: join(root, 'thumbs'), captions: join(root, 'captions') }
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
const token = 'tok_ABCdef123456789'
const v: Video = {
  id: 'v1',
  title: 'Demo <script>alert(1)</script>',
  createdAt: '2026-01-01T00:00:00Z',
  durationMs: 5000,
  file: 'v1.mp4',
  mime: 'video/mp4',
  sizeBytes: bytes.length,
  thumb: 'v1.jpg',
  status: 'ready',
  markers: [{ t: 1500, label: 'Inicio' }],
  transcript: { status: 'done', vttFile: 'v1.vtt', text: 'hola' },
  shareToken: token
}
const server = new ShareServer({ byToken: (t) => (t === token ? v : null) }, dirs)
let base = ''

beforeAll(async () => {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  writeFileSync(join(dirs.videos, 'v1.mp4'), bytes)
  writeFileSync(join(dirs.thumbs, 'v1.jpg'), 'jpg')
  writeFileSync(join(dirs.captions, 'v1.vtt'), 'WEBVTT\n')
  const port = await server.start('127.0.0.1', 0)
  base = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  await server.stop()
  rmSync(root, { recursive: true, force: true })
})

describe('ShareServer', () => {
  it('serves an escaped player page with chapters', async () => {
    const r = await fetch(`${base}/v/${token}`)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Demo &lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('Inicio')
    expect(html).toContain(`/v/${token}/captions.vtt`)
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('serves the whole video and byte ranges', async () => {
    const full = await fetch(`${base}/v/${token}/video`)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true)

    const part = await fetch(`${base}/v/${token}/video`, { headers: { Range: 'bytes=100-199' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(100, 200))).toBe(true)

    const suffix = await fetch(`${base}/v/${token}/video`, { headers: { Range: 'bytes=-10' } })
    expect(suffix.status).toBe(206)
    expect(Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(990))).toBe(true)

    const bad = await fetch(`${base}/v/${token}/video`, { headers: { Range: 'bytes=5000-' } })
    expect(bad.status).toBe(416)
  })

  it('serves captions and thumbnails with the right types', async () => {
    const c = await fetch(`${base}/v/${token}/captions.vtt`)
    expect(c.headers.get('content-type')).toContain('text/vtt')
    const t = await fetch(`${base}/v/${token}/thumb.jpg`)
    expect(t.headers.get('content-type')).toBe('image/jpeg')
  })

  it('rejects unknown tokens, path tricks and writes', async () => {
    expect((await fetch(`${base}/v/unknown-token-123`)).status).toBe(404)
    expect((await fetch(`${base}/v/${token}/../../etc/passwd`)).status).toBe(404)
    expect((await fetch(`${base}/`)).status).toBe(404)
    expect((await fetch(`${base}/v/${token}`, { method: 'POST' })).status).toBe(405)
  })
})
