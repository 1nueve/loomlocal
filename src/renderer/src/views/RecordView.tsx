import { useCallback, useEffect, useState } from 'react'
import type { PermissionStatus, Settings, SourceInfo } from '../../../shared/types'
import { MicMeter } from '../components/MicMeter'
import { listDevices, type DeviceLists } from '../devices'
import { engine } from '../recorder-engine'

const api = window.api
const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl'

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`loomlocal.${key}`)
  } catch {
    return null
  }
}
function savePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`loomlocal.${key}`)
    else localStorage.setItem(`loomlocal.${key}`, value)
  } catch {
    // ignore
  }
}

export function RecordView({ settings, onSettings }: { settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], mics: [], monitors: [] })
  const [cameraId, setCameraId] = useState<string | null>(loadPref('camera'))
  const [micId, setMicId] = useState<string | null>(loadPref('mic'))
  const [systemAudio, setSystemAudio] = useState(loadPref('systemAudio') === '1')
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const refreshSources = useCallback(async () => {
    try {
      let list = await api.listSources()
      // The capturer can come back empty right after launch; retry briefly.
      for (let i = 0; i < 5 && list.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 600))
        list = await api.listSources()
      }
      setSources(list)
      setSourceId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list.find((s) => s.kind === 'screen')?.id ?? list[0]?.id ?? null))
    } catch (e) {
      setError(`No pude listar pantallas: ${(e as Error).message}`)
    }
  }, [])

  const refreshDevices = useCallback(async () => {
    try {
      const d = await listDevices()
      setDevices(d)
      setCameraId((c) => (c && d.cameras.some((x) => x.deviceId === c) ? c : null))
      setMicId((m) => (m && d.mics.some((x) => x.deviceId === m) ? m : d.mics[0]?.deviceId ?? null))
      setMonitorId(d.monitors[0]?.deviceId ?? null)
    } catch (e) {
      setError(`No pude listar cámaras y micrófonos: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    void api.permissions().then(setPerm)
    void refreshSources()
    void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshSources, refreshDevices])

  // Show the camera bubble as a live preview while setting up.
  useEffect(() => {
    savePref('camera', cameraId)
    void api.showBubble(cameraId)
  }, [cameraId])
  useEffect(() => savePref('mic', micId), [micId])
  useEffect(() => savePref('systemAudio', systemAudio ? '1' : '0'), [systemAudio])

  const start = async () => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return setError('Elige una pantalla o ventana.')
    setError(null)
    setStarting(true)
    try {
      await engine.start({
        sourceId: source.id,
        displayId: source.displayId,
        cameraId,
        micId,
        systemAudio,
        systemAudioDeviceId: monitorId
      })
    } catch (e) {
      setError(`No se pudo iniciar la grabación: ${(e as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  const screens = sources.filter((s) => s.kind === 'screen')
  const windows = sources.filter((s) => s.kind === 'window')
  const needsScreenPerm = perm?.platform === 'darwin' && perm.screen !== 'granted'
  const needsAccessibility = perm?.platform === 'darwin' && settings.clickRipples && perm.accessibility === false

  return (
    <div className="record">
      <section className="panel sources">
        <div className="panel-head">
          <h2>¿Qué quieres grabar?</h2>
          <button className="ghost" onClick={() => void refreshSources()}>Actualizar</button>
        </div>
        {needsScreenPerm && (
          <div className="banner">
            macOS necesita el permiso de <b>Grabación de pantalla</b> para LoomLocal. Actívalo y reinicia la app.
            <button onClick={() => void api.openPermissionSettings('screen')}>Abrir Ajustes del Sistema</button>
          </div>
        )}
        {api.platform === 'linux' && (
          <p className="hint">En Ubuntu con Wayland, el sistema te pedirá elegir la pantalla al empezar.</p>
        )}
        {sources.length === 0 && (
          <div className="banner">
            No encontré pantallas para grabar.
            <button onClick={() => void refreshSources()}>Reintentar</button>
          </div>
        )}
        <h3>Pantallas</h3>
        <div className="source-grid">
          {screens.map((s) => (
            <SourceCard key={s.id} source={s} selected={s.id === sourceId} onClick={() => setSourceId(s.id)} />
          ))}
        </div>
        {windows.length > 0 && (
          <>
            <h3>Ventanas</h3>
            <div className="source-grid">
              {windows.map((s) => (
                <SourceCard key={s.id} source={s} selected={s.id === sourceId} onClick={() => setSourceId(s.id)} />
              ))}
            </div>
          </>
        )}
      </section>

      <aside className="panel setup">
        <h2>Cámara y audio</h2>
        <label className="field">
          <span>Cámara</span>
          <select value={cameraId ?? ''} onChange={(e) => setCameraId(e.target.value || null)}>
            <option value="">Sin cámara</option>
            {devices.cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Micrófono</span>
          <select value={micId ?? ''} onChange={(e) => setMicId(e.target.value || null)}>
            <option value="">Sin micrófono</option>
            {devices.mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>
        <MicMeter deviceId={micId} />
        <label className="check">
          <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
          <span>Grabar audio del sistema</span>
        </label>
        {systemAudio && api.platform === 'linux' && (
          <label className="field">
            <span>Fuente de audio del sistema</span>
            <select value={monitorId ?? ''} onChange={(e) => setMonitorId(e.target.value || null)}>
              {devices.monitors.length === 0 && <option value="">No encontré un “Monitor of …”</option>}
              {devices.monitors.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
        )}
        {systemAudio && api.platform === 'darwin' && <p className="hint">Requiere macOS 13 o superior.</p>}

        <h2>Puntero y dibujo</h2>
        <label className="check">
          <input type="checkbox" checked={settings.highlightCursor} onChange={(e) => onSettings({ highlightCursor: e.target.checked })} />
          <span>Resaltar el cursor</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.clickRipples} onChange={(e) => onSettings({ clickRipples: e.target.checked })} />
          <span>Mostrar clics</span>
        </label>
        {needsAccessibility && (
          <div className="banner small">
            Para mostrar clics, macOS pide el permiso de <b>Accesibilidad</b>.
            <button onClick={() => void api.openPermissionSettings('accessibility').then(() => api.permissions().then(setPerm))}>Dar permiso</button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.drawFade} onChange={(e) => onSettings({ drawFade: e.target.checked })} />
          <span>Los trazos se desvanecen solos</span>
        </label>

        {error && <div className="error">{error}</div>}
        <button className="primary big" disabled={!sourceId || starting || engine.busy} onClick={() => void start()}>
          {starting ? 'Preparando…' : 'Empezar grabación'}
        </button>
        <ul className="shortcuts">
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>P</kbd> pausar o reanudar</li>
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>S</kbd> terminar</li>
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>D</kbd> dibujar · <kbd>Esc</kbd> salir</li>
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>E</kbd> borrar trazos</li>
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>M</kbd> marcador</li>
        </ul>
      </aside>
    </div>
  )
}

function SourceCard({ source, selected, onClick }: { source: SourceInfo; selected: boolean; onClick: () => void }) {
  return (
    <button className={`source ${selected ? 'selected' : ''}`} onClick={onClick} title={source.name}>
      {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <div className="thumb-empty" />}
      <span>{source.name}</span>
    </button>
  )
}
