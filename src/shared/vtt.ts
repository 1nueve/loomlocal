export interface Cue {
  start: number
  end: number
  text: string
}

/** "01:02:03.450" or "02:03.450" → milliseconds. */
export function parseTimestamp(ts: string): number {
  const parts = ts.trim().replace(',', '.').split(':')
  let h = 0
  let m = 0
  let s = 0
  if (parts.length === 3) {
    h = Number(parts[0])
    m = Number(parts[1])
    s = Number(parts[2])
  } else if (parts.length === 2) {
    m = Number(parts[0])
    s = Number(parts[1])
  } else {
    s = Number(parts[0])
  }
  if ([h, m, s].some((n) => Number.isNaN(n))) return NaN
  return Math.round(((h * 60 + m) * 60 + s) * 1000)
}

export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = []
  const blocks = input.replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx === -1) continue
    const [a, b] = lines[idx].split('-->')
    const start = parseTimestamp(a)
    const end = parseTimestamp(b.trim().split(/\s+/)[0])
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    const text = lines
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) cues.push({ start, end, text })
  }
  return cues
}

/** Milliseconds → "m:ss" or "h:mm:ss". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
