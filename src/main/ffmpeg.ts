import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { sep } from 'node:path'

const req = createRequire(__filename)

/** Bundled ffmpeg-static binary when present, otherwise `ffmpeg` from PATH. */
export function resolveFfmpeg(): string {
  if (process.env.LOOMLOCAL_FFMPEG) return process.env.LOOMLOCAL_FFMPEG
  try {
    const p = req('ffmpeg-static') as string | null
    if (p) {
      const unpacked = p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
      for (const candidate of [unpacked, p]) {
        if (existsSync(candidate) && statSync(candidate).size > 0) return candidate
      }
    }
  } catch {
    // optional dependency not installed
  }
  return 'ffmpeg'
}

export interface RunResult {
  code: number
  stderr: string
}

export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
    })
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
      : undefined
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, stderr })
    })
  })
}

export async function runOrThrow(bin: string, args: string[], label: string): Promise<void> {
  const r = await run(bin, args)
  if (r.code !== 0) {
    const tail = r.stderr.trim().split('\n').slice(-6).join('\n')
    throw new Error(`${label} falló (código ${r.code}): ${tail}`)
  }
}
