import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, parseVtt, type Cue } from '../../../shared/vtt'
import type { Marker, ShareInfo, Video } from '../../../shared/types'
import { statusLabel } from './LibraryView'

const api = window.api

export function VideoView({
  video,
  share,
  onBack,
  onEnableLan
}: {
  video: Video
  share: ShareInfo | null
  onBack: () => void
  onEnableLan: () => Promise<void>
}) {
  const player = useRef<HTMLVideoElement>(null)
  const [title, setTitle] = useState(video.title)
  const [cues, setCues] = useState<Cue[]>([])
  const [now, setNow] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => setTitle(video.title), [video.id, video.title])

  const base = share ? `${share.localBase}/v/${video.shareToken}` : null
  const src = base ? `${base}/video?f=${encodeURIComponent(video.file)}` : undefined

  useEffect(() => {
    setCues([])
    if (!base || video.transcript.status !== 'done') return
    let cancelled = false
    fetch(`${base}/captions.vtt`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => !cancelled && setCues(parseVtt(t)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [base, video.transcript.status])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const seek = (ms: number) => {
    const p = player.current
    if (!p) return
    p.currentTime = ms / 1000
    void p.play()
  }

  const saveTitle = async () => {
    if (title.trim() && title !== video.title) await api.updateVideo(video.id, { title })
  }

  const setMarkers = (markers: Marker[]) => api.updateVideo(video.id, { markers })

  const addMarker = () => {
    const t = Math.round((player.current?.currentTime ?? 0) * 1000)
    void setMarkers([...video.markers, { t, label: `Marcador ${video.markers.length + 1}` }])
  }

  const copyLink = async () => {
    let info = share
    if (!info?.lanEnabled) {
      if (!confirm('Para abrir el enlace desde otro dispositivo hay que activar “Compartir en mi red”. ¿Activarlo ahora?')) return
      await onEnableLan()
      info = await api.shareInfo()
    }
    if (!info.lanBase) return flash('No encontré la dirección de tu red local. ¿Estás conectado a Wi-Fi?')
    api.copyText(`${info.lanBase}/v/${video.shareToken}`)
    flash('Enlace copiado. Funciona en dispositivos de tu misma red.')
  }

  const remove = async () => {
    if (!confirm(`¿Borrar “${video.title}”? Esta acción no se puede deshacer.`)) return
    await api.deleteVideo(video.id)
    onBack()
  }

  const activeCue = useMemo(() => cues.findIndex((c) => now >= c.start && now < c.end), [cues, now])
  const badge = statusLabel(video)

  return (
    <div className="video-view">
      <div className="video-main">
        <button className="ghost back" onClick={onBack}>← Biblioteca</button>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Título"
        />
        <div className="meta-row">
          <span>{new Date(video.createdAt).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })}</span>
          <span>{formatDuration(video.durationMs)}</span>
          <span>{(video.sizeBytes / 1_048_576).toFixed(1)} MB</span>
          {badge && <span className="badge inline">{badge}</span>}
        </div>
        {video.status === 'error' ? (
          <div className="error">{video.error ?? 'No se pudo procesar el video.'}</div>
        ) : video.status === 'processing' ? (
          <div className="player-placeholder">Procesando la grabación…</div>
        ) : (
          <video
            key={video.file}
            ref={player}
            className="player"
            src={src}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setNow((e.target as HTMLVideoElement).currentTime * 1000)}
          >
            {video.transcript.status === 'done' && base && <track kind="subtitles" src={`${base}/captions.vtt`} srcLang="es" label="Subtítulos" />}
          </video>
        )}
        {video.error && video.status !== 'error' && <p className="hint">{video.error}</p>}
        <div className="actions">
          <button className="primary" onClick={() => void copyLink()} disabled={video.status !== 'ready'}>Copiar enlace</button>
          <button onClick={() => void api.exportVideo(video.id).then((p) => p && flash('Video exportado.'))} disabled={video.status !== 'ready'}>Descargar</button>
          <button onClick={() => void api.revealVideo(video.id)}>Mostrar en carpeta</button>
          <button className="danger" onClick={() => void remove()}>Borrar</button>
        </div>
        {video.summary && (
          <section className="summary">
            <h3>Resumen</h3>
            <p>{video.summary}</p>
          </section>
        )}
      </div>

      <aside className="video-side">
        <section>
          <div className="panel-head">
            <h3>Capítulos y marcadores</h3>
            <button className="ghost" onClick={addMarker} disabled={video.status !== 'ready'}>+ Aquí</button>
          </div>
          {video.markers.length === 0 && <p className="hint">Agrega marcadores durante la grabación o desde aquí.</p>}
          <ul className="markers">
            {video.markers.map((m, i) => (
              <li key={`${m.t}-${i}`}>
                <button className="time" onClick={() => seek(m.t)}>{formatDuration(m.t)}</button>
                <input
                  defaultValue={m.label}
                  onBlur={(e) => {
                    if (e.target.value !== m.label) void setMarkers(video.markers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }}
                  aria-label="Nombre del marcador"
                />
                <button className="ghost icon" title="Quitar" onClick={() => void setMarkers(video.markers.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="panel-head">
            <h3>Transcripción</h3>
            {(video.transcript.status === 'error' || video.transcript.status === 'unavailable') && (
              <button className="ghost" onClick={() => void api.retryTranscription(video.id)}>Reintentar</button>
            )}
          </div>
          {video.transcript.status === 'none' && <p className="hint">Se generará al terminar el procesamiento.</p>}
          {(video.transcript.status === 'pending' || video.transcript.status === 'running') && <p className="hint">Transcribiendo con Whisper en tu equipo…</p>}
          {(video.transcript.status === 'error' || video.transcript.status === 'unavailable') && <p className="hint">{video.transcript.error}</p>}
          {cues.length > 0 && (
            <ol className="cues">
              {cues.map((c, i) => (
                <li key={i} className={i === activeCue ? 'active' : ''}>
                  <button className="time" onClick={() => seek(c.start)}>{formatDuration(c.start)}</button>
                  <span>{c.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
