import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, type EventChannel, type LoomApi } from '../shared/api'

const allowed = new Set<string>(EVENTS)

const api: LoomApi = {
  platform: process.platform,
  listSources: () => ipcRenderer.invoke('sources:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  permissions: () => ipcRenderer.invoke('perm:status'),
  requestPermission: (kind) => ipcRenderer.invoke('perm:request', kind),
  openPermissionSettings: (kind) => ipcRenderer.invoke('perm:open', kind),
  relaunch: () => ipcRenderer.send('app:relaunch'),

  showBubble: (cameraId, micId) => ipcRenderer.invoke('bubble:show', cameraId, micId),
  bubbleResize: (size) => ipcRenderer.send('bubble:resize', size),
  bubbleResizeTo: (width) => ipcRenderer.send('bubble:resize-to', width),
  bubbleShape: (shape) => ipcRenderer.send('bubble:shape', shape),

  recSelect: (opts) => ipcRenderer.invoke('rec:select', opts),
  recPrepare: () => ipcRenderer.invoke('rec:prepare'),
  recChunk: (data) => ipcRenderer.invoke('rec:chunk', data),
  recState: (status) => ipcRenderer.send('rec:state', status),
  recDiscard: () => ipcRenderer.invoke('rec:discard'),
  recFinish: (payload) => ipcRenderer.invoke('rec:finish', payload),
  recCancel: () => ipcRenderer.invoke('rec:cancel'),
  recCommand: (cmd) => ipcRenderer.send('rec:command', cmd),
  countdownDone: () => ipcRenderer.send('countdown:done'),
  overlayInit: () => ipcRenderer.invoke('overlay:init'),
  recStatus: () => ipcRenderer.invoke('rec:status'),
  setDrawing: (state) => ipcRenderer.send('draw:set', state),
  clearDrawing: () => ipcRenderer.send('draw:clear'),
  hideToolbar: () => ipcRenderer.send('toolbar:hide'),

  listVideos: () => ipcRenderer.invoke('videos:list'),
  getVideo: (id) => ipcRenderer.invoke('videos:get', id),
  updateVideo: (id, patch) => ipcRenderer.invoke('videos:update', id, patch),
  deleteVideo: (id) => ipcRenderer.invoke('videos:delete', id),
  exportVideo: (id) => ipcRenderer.invoke('videos:export', id),
  revealVideo: (id) => ipcRenderer.invoke('videos:reveal', id),
  retryTranscription: (id) => ipcRenderer.invoke('videos:retry-transcription', id),
  shareInfo: () => ipcRenderer.invoke('share:info'),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  testWhisper: () => ipcRenderer.invoke('whisper:test'),

  on(channel: EventChannel, cb: (payload: unknown) => void) {
    if (!allowed.has(channel)) throw new Error(`Canal no permitido: ${channel}`)
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
