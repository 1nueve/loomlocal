import { randomBytes } from 'node:crypto'
import type { Video } from '../shared/types'
import { readJson, writeJson } from './json-file'

interface LibraryFile {
  version: 1
  videos: Video[]
}

export function newToken(): string {
  return randomBytes(16).toString('base64url')
}

export function newId(): string {
  const d = new Date()
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

/** Small JSON-backed video library. Writes are synchronous and atomic. */
export class LibraryStore {
  private videos: Video[]

  constructor(private readonly file: string) {
    const data = readJson<LibraryFile>(file, { version: 1, videos: [] })
    this.videos = Array.isArray(data.videos) ? data.videos : []
  }

  list(): Video[] {
    return [...this.videos].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): Video | null {
    return this.videos.find((v) => v.id === id) ?? null
  }

  byToken(token: string): Video | null {
    return this.videos.find((v) => v.shareToken === token) ?? null
  }

  add(video: Video): Video {
    this.videos.push(video)
    this.save()
    return video
  }

  update(id: string, patch: Partial<Video>): Video | null {
    const v = this.get(id)
    if (!v) return null
    Object.assign(v, patch)
    this.save()
    return v
  }

  remove(id: string): Video | null {
    const v = this.get(id)
    if (!v) return null
    this.videos = this.videos.filter((x) => x.id !== id)
    this.save()
    return v
  }

  private save(): void {
    writeJson(this.file, { version: 1, videos: this.videos } satisfies LibraryFile)
  }
}
