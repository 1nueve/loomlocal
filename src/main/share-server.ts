import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { Video } from '../shared/types'

export interface ShareDirs {
  videos: string
  thumbs: string
  captions: string
}

export interface VideoLookup {
  byToken(token: string): Video | null
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.vtt': 'text/vtt; charset=utf-8'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

/** Serves a file honoring HTTP Range requests (needed for video seeking). */
export function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string): void {
  if (!existsSync(file)) return send(res, 404, 'No encontrado')
  const size = statSync(file).size
  const range = req.headers.range
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!m || (m[1] === '' && m[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return void res.end()
    }
    let start: number
    let end: number
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    } else {
      start = Number(m[1])
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return void res.end()
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...base, 'Content-Length': size })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file).pipe(res)
}

function playerPage(v: Video, token: string): string {
  const t = encodeURIComponent(token)
  const title = escapeHtml(v.title)
  const captions = v.transcript.vttFile
    ? `<track kind="subtitles" src="/v/${t}/captions.vtt" srclang="es" label="Subtítulos" default>`
    : ''
  const chapters = v.markers.length
    ? `<ol class="chapters">${v.markers
        .map((m) => {
          const s = Math.floor(m.t / 1000)
          const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
          return `<li><a href="#" data-t="${m.t / 1000}">${label}</a> ${escapeHtml(m.label)}</li>`
        })
        .join('')}</ol>`
    : ''
  const summary = v.summary ? `<p class="summary">${escapeHtml(v.summary)}</p>` : ''
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f8;--fg:#16181d;--muted:#5b6270;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#eceef2;--muted:#9aa1ad;--card:#181b21}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 12px}video{width:100%;border-radius:12px;background:#000;max-height:75vh}
.meta{color:var(--muted);font-size:14px;margin:8px 0 16px}.summary{background:var(--card);padding:12px 16px;border-radius:10px}
.chapters{background:var(--card);padding:12px 16px 12px 36px;border-radius:10px}.chapters a{font-variant-numeric:tabular-nums;color:#7c5cff}
</style></head><body><main>
<h1>${title}</h1>
<video id="v" controls playsinline preload="metadata" poster="/v/${t}/thumb.jpg" src="/v/${t}/video">${captions}</video>
<div class="meta">${escapeHtml(new Date(v.createdAt).toLocaleString('es'))}</div>
${summary}${chapters}
</main>
<script>document.querySelectorAll('[data-t]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var v=document.getElementById('v');v.currentTime=Number(a.dataset.t);v.play();});});</script>
</body></html>`
}

export function createShareHandler(lookup: VideoLookup, dirs: ShareDirs) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido')
    const url = new URL(req.url ?? '/', 'http://localhost')
    const m = /^\/v\/([A-Za-z0-9_-]{8,64})(?:\/(video|thumb\.jpg|captions\.vtt))?\/?$/.exec(url.pathname)
    if (!m) return send(res, 404, 'No encontrado')
    const video = lookup.byToken(m[1])
    if (!video || video.status === 'error') return send(res, 404, 'No encontrado')
    switch (m[2]) {
      case undefined:
        return send(res, 200, playerPage(video, m[1]), 'text/html; charset=utf-8')
      case 'video': {
        const ext = video.file.slice(video.file.lastIndexOf('.'))
        return serveFile(req, res, join(dirs.videos, video.file), MIME[ext] ?? video.mime)
      }
      case 'thumb.jpg':
        if (!video.thumb) return send(res, 404, 'Sin miniatura')
        return serveFile(req, res, join(dirs.thumbs, video.thumb), MIME['.jpg'])
      case 'captions.vtt':
        if (!video.transcript.vttFile) return send(res, 404, 'Sin subtítulos')
        return serveFile(req, res, join(dirs.captions, video.transcript.vttFile), MIME['.vtt'])
    }
  }
}

/** Best guess of this machine's address on the local network. */
export function lanAddress(): string | null {
  const candidates: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) candidates.push(ni.address)
    }
  }
  const score = (a: string): number =>
    a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3
  candidates.sort((a, b) => score(a) - score(b))
  return candidates[0] ?? null
}

export class ShareServer {
  private server: Server | null = null
  port = 0
  host = '127.0.0.1'

  constructor(private readonly lookup: VideoLookup, private readonly dirs: ShareDirs) {}

  /** Starts (or restarts) on the given host. Falls back to a free port if busy. */
  async start(host: string, port: number): Promise<number> {
    await this.stop()
    const handler = createShareHandler(this.lookup, this.dirs)
    const listen = (p: number) =>
      new Promise<Server>((resolve, reject) => {
        const s = createServer(handler)
        s.once('error', reject)
        s.listen(p, host, () => resolve(s))
      })
    try {
      this.server = await listen(port)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      this.server = await listen(0)
    }
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : port
    this.host = host
    return this.port
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    if (s) {
      s.closeAllConnections?.()
      await new Promise<void>((r) => s.close(() => r()))
    }
  }
}
