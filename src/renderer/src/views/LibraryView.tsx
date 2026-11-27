import { useMemo, useState } from 'react'
import { formatDuration } from '../../../shared/vtt'
import type { ShareInfo, Video } from '../../../shared/types'

export function statusLabel(v: Video): string | null {
  if (v.status === 'processing') return 'Procesando…'
  if (v.status === 'error') return 'Error'
  if (v.converting) return 'Optimizando…'
  if (v.transcript.status === 'running' || v.transcript.status === 'pending') return 'Transcribiendo…'
  return null
}

export function LibraryView({ videos, share, onOpen }: { videos: Video[]; share: ShareInfo | null; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return videos
    return videos.filter((v) =>
      [v.title, v.summary ?? '', v.transcript.text ?? '', ...v.markers.map((m) => m.label)].some((s) => s.toLowerCase().includes(needle))
    )
  }, [videos, q])

  return (
    <div className="library">
      <div className="library-head">
        <h2>Mis videos <span className="count">{videos.length}</span></h2>
        <input className="search" placeholder="Buscar en títulos, transcripciones y marcadores" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {videos.length === 0 && <p className="empty">Aún no tienes grabaciones. Ve a “Grabar” para hacer la primera.</p>}
      {videos.length > 0 && filtered.length === 0 && <p className="empty">Nada coincide con “{q}”.</p>}
      <div className="video-grid">
        {filtered.map((v) => {
          const badge = statusLabel(v)
          return (
            <button key={v.id} className="video-card" onClick={() => onOpen(v.id)}>
              <div className="video-thumb">
                {v.thumb && share ? <img src={`${share.localBase}/v/${v.shareToken}/thumb.jpg`} alt="" loading="lazy" /> : <div className="thumb-empty" />}
                <span className="duration">{formatDuration(v.durationMs)}</span>
                {badge && <span className={`badge ${v.status === 'error' ? 'bad' : ''}`}>{badge}</span>}
              </div>
              <div className="video-meta">
                <strong>{v.title}</strong>
                <span>{new Date(v.createdAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
