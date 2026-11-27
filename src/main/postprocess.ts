import { renameSync } from 'node:fs'
import { run, runOrThrow } from './ffmpeg'

/**
 * MediaRecorder WebM files have no duration or cues, so seeking is broken.
 * A stream copy rewrites the container with a proper index. Falls back to the
 * raw file if ffmpeg cannot parse it.
 */
export async function finalizeWebm(ffmpeg: string, input: string, output: string): Promise<void> {
  const r = await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-c', 'copy', output])
  if (r.code !== 0) renameSync(input, output)
}

export async function makeThumbnail(ffmpeg: string, input: string, output: string, durationMs: number): Promise<void> {
  const at = Math.min(1, Math.max(0, durationMs / 2000))
  await runOrThrow(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', input, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', output],
    'Miniatura'
  )
}

/** H.264/AAC MP4 with faststart: plays everywhere, including iPhone Safari. */
export async function toMp4(ffmpeg: string, input: string, output: string): Promise<void> {
  await runOrThrow(
    ffmpeg,
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      output
    ],
    'Conversión a MP4'
  )
}

/** 16 kHz mono WAV, the input format whisper.cpp expects. */
export async function extractWav(ffmpeg: string, input: string, output: string): Promise<void> {
  await runOrThrow(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output],
    'Extracción de audio'
  )
}

/** Container duration in ms as reported by ffmpeg, or 0 when unknown. */
export async function probeDurationMs(ffmpeg: string, input: string): Promise<number> {
  const r = await run(ffmpeg, ['-hide_banner', '-i', input])
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr)
  if (!m) return 0
  return Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000)
}

/** True when the file has at least one audio stream. */
export async function hasAudio(ffmpeg: string, input: string): Promise<boolean> {
  const r = await run(ffmpeg, ['-hide_banner', '-i', input])
  return /Stream #\d+:\d+.*Audio:/.test(r.stderr)
}
