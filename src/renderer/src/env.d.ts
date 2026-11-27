import type { LoomApi } from '../../shared/api'

declare global {
  interface Window {
    api: LoomApi
  }
}

export {}
