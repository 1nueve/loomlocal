export interface Marker {
  /** Milliseconds from the start of the recording (pauses excluded). */
  t: number
  label: string
}

export type TranscriptStatus = 'none' | 'pending' | 'running' | 'done' | 'error' | 'unavailable'

export interface Transcript {
  status: TranscriptStatus
  text?: string
  /** File name inside the captions directory. */
  vttFile?: string
  error?: string
}

export type VideoStatus = 'processing' | 'ready' | 'error'

export interface Video {
  id: string
  title: string
  createdAt: string
  durationMs: number
  /** File name inside the videos directory. */
  file: string
  mime: string
  sizeBytes: number
  /** File name inside the thumbnails directory. */
  thumb?: string
  status: VideoStatus
  error?: string
  /** True while the H.264 MP4 copy is being produced. */
  converting?: boolean
  markers: Marker[]
  transcript: Transcript
  summary?: string
  shareToken: string
}

export type BubbleSize = 's' | 'm' | 'l'
export type BubbleShape = 'circle' | 'rounded'

export interface Settings {
  sharePort: number
  shareOnLan: boolean
  highlightCursor: boolean
  clickRipples: boolean
  countdownSeconds: number
  drawFade: boolean
  bubbleSize: BubbleSize
  bubbleShape: BubbleShape
  convertToMp4: boolean
  whisperEnabled: boolean
  whisperBin: string
  whisperModel: string
  whisperLanguage: string
  ollamaEnabled: boolean
  ollamaUrl: string
  ollamaModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  sharePort: 4848,
  shareOnLan: false,
  highlightCursor: true,
  clickRipples: true,
  countdownSeconds: 3,
  drawFade: true,
  bubbleSize: 'm',
  bubbleShape: 'circle',
  convertToMp4: true,
  whisperEnabled: true,
  whisperBin: 'whisper-cli',
  whisperModel: '',
  whisperLanguage: 'auto',
  ollamaEnabled: false,
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2'
}

export const BUBBLE_PX: Record<BubbleSize, number> = { s: 160, m: 240, l: 360 }

export interface SourceInfo {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
  displayId?: string
}

export interface RecordingOptions {
  sourceId: string
  displayId?: string
  cameraId: string | null
  micId: string | null
  systemAudio: boolean
  /** Linux: PulseAudio/PipeWire "Monitor of …" input used as system audio. */
  systemAudioDeviceId?: string | null
}

export type RecState = 'idle' | 'countdown' | 'recording' | 'paused' | 'finishing'

export interface RecStatus {
  state: RecState
  elapsedMs: number
  markerCount: number
}

export type RecCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle-pause' }
  | { type: 'restart' }
  | { type: 'cancel' }
  | { type: 'finish' }
  | { type: 'marker' }

export type DrawTool = 'pen' | 'highlighter' | 'arrow' | 'rect'

export interface DrawState {
  enabled: boolean
  tool: DrawTool
  color: string
}

export interface PermissionStatus {
  platform: string
  /** Name the OS shows in privacy settings: "Electron" in dev, "LoomLocal" when packaged. */
  appName: string
  /** Running via npm run dev: macOS attributes privacy permissions to the terminal. */
  isDev: boolean
  screen: string
  camera: string
  microphone: string
  accessibility: boolean | null
}

export interface ShareInfo {
  localBase: string
  lanBase: string | null
  lanEnabled: boolean
  port: number
}

export interface VideoPatch {
  title?: string
  markers?: Marker[]
}
