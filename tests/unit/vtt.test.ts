import { describe, expect, it } from 'vitest'
import { formatDuration, parseTimestamp, parseVtt } from '../../src/shared/vtt'

describe('vtt', () => {
  it('parses timestamps with and without hours', () => {
    expect(parseTimestamp('00:01:02.500')).toBe(62_500)
    expect(parseTimestamp('01:02.250')).toBe(62_250)
    expect(parseTimestamp('1:00:00,000')).toBe(3_600_000)
    expect(parseTimestamp('x')).toBeNaN()
  })

  it('parses whisper.cpp style VTT', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.400
 Hola, este es un video de prueba.

2
00:00:02.400 --> 00:00:05.000 align:start
<v Speaker>Segunda línea</v>
`
    expect(parseVtt(vtt)).toEqual([
      { start: 0, end: 2400, text: 'Hola, este es un video de prueba.' },
      { start: 2400, end: 5000, text: 'Segunda línea' }
    ])
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_400)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})
