import { useCallback, useEffect, useState } from 'react'
import type { Settings, ShareInfo, Video } from '../../shared/types'
import { LibraryView } from './views/LibraryView'
import { RecordView } from './views/RecordView'
import { SettingsView } from './views/SettingsView'
import { VideoView } from './views/VideoView'

const api = window.api

function useHashRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/record'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [route, (r: string) => (window.location.hash = r)]
}

/** Main window: record panel, library, video detail and settings. */
export function App() {
  const [route, go] = useHashRoute()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [share, setShare] = useState<ShareInfo | null>(null)

  const reload = useCallback(async () => {
    setVideos(await api.listVideos())
  }, [])

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.shareInfo().then(setShare)
    void reload()
    const offs = [
      api.on('library:changed', () => void reload()),
      api.on('navigate', (r) => go(String(r))),
      api.on('settings:changed', (s) => {
        setSettings(s as Settings)
        void api.shareInfo().then(setShare)
      })
    ]
    return () => offs.forEach((o) => o())
  }, [reload])

  const updateSettings = async (patch: Partial<Settings>) => {
    setSettings(await api.setSettings(patch))
    setShare(await api.shareInfo())
  }

  if (!settings) return null
  const videoId = route.startsWith('/video/') ? route.slice('/video/'.length) : null
  const video = videoId ? videos.find((v) => v.id === videoId) : null
  const tab = route.startsWith('/library') || videoId ? 'library' : route.startsWith('/settings') ? 'settings' : 'record'
  const busy = videos.filter((v) => v.status === 'processing' || v.converting || v.transcript.status === 'running').length

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          LoomLocal
        </div>
        <nav>
          <button className={tab === 'record' ? 'active' : ''} onClick={() => go('/record')}>Grabar</button>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => go('/library')}>
            Biblioteca {busy > 0 && <span className="pill">{busy}</span>}
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => go('/settings')}>Ajustes</button>
        </nav>
      </header>
      <main className="content">
        {tab === 'record' && <RecordView settings={settings} onSettings={(p) => void updateSettings(p)} />}
        {tab === 'library' && !videoId && <LibraryView videos={videos} share={share} onOpen={(id) => go(`/video/${id}`)} />}
        {videoId && video && (
          <VideoView video={video} share={share} onBack={() => go('/library')} onEnableLan={() => updateSettings({ shareOnLan: true })} />
        )}
        {videoId && !video && <p className="empty">No encontré ese video.</p>}
        {tab === 'settings' && <SettingsView settings={settings} share={share} onSettings={updateSettings} />}
      </main>
    </div>
  )
}
