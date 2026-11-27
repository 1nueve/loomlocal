import { existsSync, readFileSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Settings } from '../shared/types'
import { run } from './ffmpeg'

/** Locates an executable either as an absolute path or on PATH. */
export function findExecutable(bin: string): string | null {
  if (!bin) return null
  if (isAbsolute(bin)) return existsSync(bin) ? bin : null
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  const extraDirs = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : ['/usr/local/bin']
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...extraDirs]
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, bin + ext)
      if (dir && existsSync(p)) return p
    }
  }
  return null
}

export interface WhisperCheck {
  ok: boolean
  message: string
  bin?: string
}

export function checkWhisper(settings: Settings): WhisperCheck {
  if (!settings.whisperEnabled) return { ok: false, message: 'La transcripción está desactivada en Ajustes.' }
  const bin = findExecutable(settings.whisperBin)
  if (!bin) {
    return {
      ok: false,
      message: `No encontré "${settings.whisperBin}". Instala whisper.cpp (macOS: brew install whisper-cpp) o indica la ruta del binario whisper-cli en Ajustes.`
    }
  }
  if (!settings.whisperModel || !existsSync(settings.whisperModel)) {
    return {
      ok: false,
      message: 'Falta el modelo de Whisper. Descarga por ejemplo ggml-base.bin y selecciona su ruta en Ajustes.',
      bin
    }
  }
  return { ok: true, message: `Listo: ${bin}`, bin }
}

/**
 * Runs whisper.cpp on a 16 kHz WAV. Produces `<outBase>.vtt` and `<outBase>.txt`.
 */
export async function runWhisper(settings: Settings, wav: string, outBase: string): Promise<{ vtt: string; text: string }> {
  const check = checkWhisper(settings)
  if (!check.ok || !check.bin) throw new Error(check.message)
  const args = ['-m', settings.whisperModel, '-f', wav, '-l', settings.whisperLanguage || 'auto', '-ovtt', '-otxt', '-of', outBase, '-np']
  const r = await run(check.bin, args)
  if (r.code !== 0 || !existsSync(`${outBase}.vtt`)) {
    throw new Error(`Whisper falló (código ${r.code}): ${r.stderr.trim().split('\n').slice(-4).join(' ')}`)
  }
  const text = existsSync(`${outBase}.txt`) ? readFileSync(`${outBase}.txt`, 'utf8').trim() : ''
  return { vtt: `${outBase}.vtt`, text }
}

/** Optional: asks a local Ollama model for a title and a short summary. */
export async function summarizeWithOllama(
  settings: Settings,
  transcript: string
): Promise<{ title?: string; summary?: string }> {
  const prompt =
    'Eres un asistente que titula videos. A partir de la transcripción, responde SOLO JSON con las claves ' +
    '"title" (máximo 8 palabras) y "summary" (2 o 3 frases), en el mismo idioma de la transcripción.\n\n' +
    `Transcripción:\n${transcript.slice(0, 12000)}`
  const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.ollamaModel, prompt, stream: false, format: 'json' }),
    signal: AbortSignal.timeout(120_000)
  })
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}`)
  const body = (await res.json()) as { response?: string }
  const parsed = JSON.parse(body.response ?? '{}') as { title?: unknown; summary?: unknown }
  return {
    title: typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 120) : undefined,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined
  }
}
