import { useState } from 'react'
import type { Settings, ShareInfo } from '../../../shared/types'

const api = window.api

export function SettingsView({ settings, share, onSettings }: { settings: Settings; share: ShareInfo | null; onSettings: (p: Partial<Settings>) => Promise<void> }) {
  const [whisperMsg, setWhisperMsg] = useState<string | null>(null)
  const [port, setPort] = useState(String(settings.sharePort))

  const text = (key: keyof Settings) => ({
    defaultValue: String(settings[key]),
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      if (e.target.value !== String(settings[key])) void onSettings({ [key]: e.target.value })
    }
  })

  return (
    <div className="settings">
      <section className="panel">
        <h2>Compartir</h2>
        <label className="check">
          <input type="checkbox" checked={settings.shareOnLan} onChange={(e) => void onSettings({ shareOnLan: e.target.checked })} />
          <span>Compartir en mi red local (Wi-Fi o cable)</span>
        </label>
        <p className="hint">
          Cada video tiene un enlace con un código secreto. Solo lo pueden abrir dispositivos de tu misma red y solo mientras LoomLocal esté abierta.
          {share?.lanBase && <> Dirección actual: <code>{share.lanBase}</code></>}
        </p>
        <label className="field narrow">
          <span>Puerto</span>
          <input
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            onBlur={() => {
              const n = Number(port)
              if (n >= 1024 && n <= 65535 && n !== settings.sharePort) void onSettings({ sharePort: n })
              else setPort(String(settings.sharePort))
            }}
          />
        </label>
      </section>

      <section className="panel">
        <h2>Grabación</h2>
        <label className="field narrow">
          <span>Cuenta regresiva (segundos)</span>
          <select value={settings.countdownSeconds} onChange={(e) => void onSettings({ countdownSeconds: Number(e.target.value) })}>
            {[0, 3, 5].map((n) => (
              <option key={n} value={n}>{n === 0 ? 'Sin cuenta regresiva' : n}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.convertToMp4} onChange={(e) => void onSettings({ convertToMp4: e.target.checked })} />
          <span>Convertir a MP4 (H.264) para que se vea en cualquier dispositivo, incluido el iPhone</span>
        </label>
      </section>

      <section className="panel">
        <h2>Transcripción con IA (local)</h2>
        <label className="check">
          <input type="checkbox" checked={settings.whisperEnabled} onChange={(e) => void onSettings({ whisperEnabled: e.target.checked })} />
          <span>Transcribir automáticamente con Whisper</span>
        </label>
        <label className="field">
          <span>Programa whisper.cpp (nombre o ruta completa)</span>
          <input {...text('whisperBin')} placeholder="whisper-cli" />
        </label>
        <label className="field">
          <span>Modelo (ruta al archivo .bin)</span>
          <input {...text('whisperModel')} placeholder="/ruta/a/ggml-base.bin" />
        </label>
        <label className="field narrow">
          <span>Idioma</span>
          <select value={settings.whisperLanguage} onChange={(e) => void onSettings({ whisperLanguage: e.target.value })}>
            <option value="auto">Detectar</option>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="pt">Portugués</option>
          </select>
        </label>
        <button onClick={() => void api.testWhisper().then((r) => setWhisperMsg(r.message))}>Probar configuración</button>
        {whisperMsg && <p className="hint">{whisperMsg}</p>}

        <h3>Título y resumen automáticos (opcional)</h3>
        <label className="check">
          <input type="checkbox" checked={settings.ollamaEnabled} onChange={(e) => void onSettings({ ollamaEnabled: e.target.checked })} />
          <span>Usar Ollama en este equipo para sugerir título y resumen</span>
        </label>
        <label className="field">
          <span>Dirección de Ollama</span>
          <input {...text('ollamaUrl')} />
        </label>
        <label className="field narrow">
          <span>Modelo</span>
          <input {...text('ollamaModel')} />
        </label>
      </section>
    </div>
  )
}
