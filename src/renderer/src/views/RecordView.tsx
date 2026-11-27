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

  const refreshSources = useCallback(async (quiet = false) => {
    try {
      let list = await api.listSources()
      if (quiet) {
        setSources(list)
        return
      }
      // The capturer can come back empty right after launch; retry briefly.
      for (let i = 0; i < 5 && list.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 600))
        list = await api.listSources()
      }
      setSources(list)
      setSourceId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list.find((s) => s.kind === 'screen')?.id ?? list[0]?.id ?? null))
    } catch (e) {
      // Without Screen Recording permission macOS refuses to list sources;
      // the permission banner already explains that.
      if (!quiet) setError(`No pude listar pantallas: ${(e as Error).message}`)
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
    void (async () => {
      let p = await api.permissions()
      if (p.platform === 'darwin') {
        // Shows the macOS camera/microphone prompts on first run.
        for (const kind of ['microphone', 'camera'] as const) {
          if (p[kind] === 'not-determined') await api.requestPermission(kind)
        }
        p = await api.permissions()
      }
      setPerm(p)
      const screenOk = p.platform !== 'darwin' || p.screen === 'granted'
      void refreshSources(!screenOk)
      void refreshDevices()
    })()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshSources, refreshDevices])

  // Show the camera bubble as a live preview while setting up.
  useEffect(() => {
    savePref('camera', cameraId)
    void api.showBubble(cameraId, micId)
  }, [cameraId, micId])
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
  const mac = perm?.platform === 'darwin'
  const needsScreenPerm = mac && perm.screen !== 'granted'
  const needsAccessibility = mac && settings.clickRipples && perm.accessibility === false
  const deniedMedia = mac ? (['camera', 'microphone'] as const).filter((k) => perm[k] === 'denied') : []
  const appName = perm?.appName ?? 'LoomLocal'

  return (
    <div className="record">
      <section className="panel sources">
        <div className="panel-head">
          <h2>¿Qué quieres grabar?</h2>
          <button className="ghost" onClick={() => void refreshSources()}>Actualizar</button>
        </div>
        {needsScreenPerm && (
          <div className="banner steps">
            <div>
              <strong>Falta un permiso de macOS para grabar la pantalla</strong>
              <ol>
                <li>Abre <b>Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla</b>.</li>
                {perm.isDev ? (
                  <>
                    <li>
                      Activa la casilla de <b>{appName}</b>: es la terminal desde la que abriste LoomLocal con <code>npm run dev</code>, y macOS le da a ella el permiso.
                    </li>
                    <li>
                      Cierra <b>{appName}</b> por completo (<kbd>⌘</kbd><kbd>Q</kbd>), ábrelo y vuelve a ejecutar <code>npm run dev</code>.
                    </li>
                  </>
                ) : (
                  <>
                    <li>Activa la casilla de <b>{appName}</b>.</li>
                    <li>Reinicia LoomLocal para que macOS aplique el permiso.</li>
                  </>
                )}
              </ol>
            </div>
            <div className="banner-actions">
              <button onClick={() => void api.openPermissionSettings('screen')}>Abrir Ajustes del Sistema</button>
              {!perm.isDev && (
                <button className="primary" onClick={() => api.relaunch()}>Reiniciar LoomLocal</button>
              )}
            </div>
          </div>
        )}
        {api.platform === 'linux' && (
          <p className="hint">En Ubuntu con Wayland, el sistema te pedirá elegir la pantalla al empezar.</p>
        )}
        {sources.length === 0 && !needsScreenPerm && (
          <div className="banner">
            <span>No encontré pantallas para grabar.</span>
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
        {cameraId && (
          <label className="check">
            <input type="checkbox" checked={settings.bubbleVoiceRing} onChange={(e) => onSettings({ bubbleVoiceRing: e.target.checked })} />
            <span>Borde de la cámara que se ilumina al hablar</span>
          </label>
        )}
        {deniedMedia.length > 0 && (
          <div className="banner small">
            <span>
              macOS bloqueó {deniedMedia.map((k) => (k === 'camera' ? 'la cámara' : 'el micrófono')).join(' y ')} para <b>{appName}</b>. Actívalo en Ajustes y reinicia.
            </span>
            <button onClick={() => void api.openPermissionSettings(deniedMedia[0])}>Abrir Ajustes</button>
          </div>
        )}
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
            <span>
              Para mostrar clics, activa <b>{appName}</b> en <b>Ajustes del Sistema → Privacidad y seguridad → Accesibilidad</b>.
            </span>
            <button onClick={() => void api.openPermissionSettings('accessibility').then(() => api.permissions().then(setPerm))}>Dar permiso</button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.drawFade} onChange={(e) => onSettings({ drawFade: e.target.checked })} />
          <span>Los trazos se desvanecen solos</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.hideToolbarWhileRecording}
            onChange={(e) => onSettings({ hideToolbarWhileRecording: e.target.checked })}
          />
          <span>Ocultar la barra de controles mientras grabo (para que no salga en el video)</span>
        </label>
        {settings.hideToolbarWhileRecording && (
          <p className="hint">
            Controla la grabación desde el icono <b>●</b> de la {api.platform === 'darwin' ? 'barra de menús' : 'bandeja del sistema'} o con los atajos.
          </p>
        )}

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
          <li><kbd>{mod}</kbd>+<kbd>⇧</kbd>+<kbd>H</kbd> mostrar u ocultar la barra</li>
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
