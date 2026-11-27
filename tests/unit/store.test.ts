import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LibraryStore, newId, newToken } from '../../src/main/store'
import type { Video } from '../../src/shared/types'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'loomlocal-store-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const video = (id: string, createdAt: string): Video => ({
  id,
  title: id,
  createdAt,
  durationMs: 1000,
  file: `${id}.mp4`,
  mime: 'video/mp4',
  sizeBytes: 1,
  status: 'ready',
  markers: [],
  transcript: { status: 'none' },
  shareToken: newToken()
})

describe('LibraryStore', () => {
  it('persists, sorts newest first and survives reload', () => {
    const file = join(tmp(), 'library.json')
    const s = new LibraryStore(file)
    s.add(video('a', '2026-01-01T00:00:00Z'))
    s.add(video('b', '2026-02-01T00:00:00Z'))
    s.update('a', { title: 'Renombrado' })
    const reloaded = new LibraryStore(file)
    expect(reloaded.list().map((v) => v.id)).toEqual(['b', 'a'])
    expect(reloaded.get('a')?.title).toBe('Renombrado')
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('finds by token and removes', () => {
    const s = new LibraryStore(join(tmp(), 'library.json'))
    const v = s.add(video('a', '2026-01-01T00:00:00Z'))
    expect(s.byToken(v.shareToken)?.id).toBe('a')
    expect(s.byToken('nope')).toBeNull()
    s.remove('a')
    expect(s.list()).toHaveLength(0)
  })

  it('recovers from a corrupt file', () => {
    const dir = tmp()
    const file = join(dir, 'library.json')
    require('node:fs').writeFileSync(file, '{not json')
    expect(new LibraryStore(file).list()).toEqual([])
  })

  it('makes unique ids and url-safe tokens', () => {
    expect(newId()).not.toBe(newId())
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})
