import type {
  BubbleSize,
  DrawState,
  Marker,
  PermissionStatus,
  RecCommand,
  RecordingOptions,
  RecStatus,
  Settings,
  ShareInfo,
  SourceInfo,
  Video,
  VideoPatch
} from './types'

/** Events pushed from the main process to renderers. */
export const EVENTS = [
  'rec:go',
  'rec:command',
  'rec:state',
  'overlay:countdown',
  'overlay:pointer',
  'overlay:click',
  'overlay:drawing',
  'overlay:clear',
  'library:changed',
  'navigate',
  'settings:changed'
] as const

export type EventChannel = (typeof EVENTS)[number]

export interface LoomApi {
  platform: string
  listSources(): Promise<SourceInfo[]>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  permissions(): Promise<PermissionStatus>
  requestPermission(kind: 'camera' | 'microphone'): Promise<boolean>
  openPermissionSettings(kind: 'screen' | 'camera' | 'microphone' | 'accessibility'): Promise<void>

  showBubble(cameraId: string | null): Promise<void>
  bubbleResize(size: BubbleSize): void
  bubbleShape(): void

  recSelect(opts: RecordingOptions): Promise<void>
  recPrepare(): Promise<void>
  recChunk(data: ArrayBuffer): Promise<void>
  recState(status: RecStatus): void
  recDiscard(): Promise<void>
  recFinish(payload: { durationMs: number; markers: Marker[] }): Promise<string | null>
  recCancel(): Promise<void>
  recCommand(cmd: RecCommand): void
  countdownDone(): void
  overlayInit(): Promise<{ countdown: number | null; drawing: DrawState }>
  recStatus(): Promise<RecStatus>
  setDrawing(state: DrawState): void
  clearDrawing(): void

  listVideos(): Promise<Video[]>
  getVideo(id: string): Promise<Video | null>
  updateVideo(id: string, patch: VideoPatch): Promise<Video | null>
  deleteVideo(id: string): Promise<void>
  exportVideo(id: string): Promise<string | null>
  revealVideo(id: string): Promise<void>
  retryTranscription(id: string): Promise<void>
  shareInfo(): Promise<ShareInfo>
  copyText(text: string): void
  testWhisper(): Promise<{ ok: boolean; message: string }>

  on(channel: EventChannel, cb: (payload: unknown) => void): () => void
}
