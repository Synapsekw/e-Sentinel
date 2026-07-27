import { describe, it, expect } from 'vitest'
import { classifyDecodeError, metaFromDetails, DECODE_ERROR_MESSAGE } from './djiLogMeta'
import type { RawDetails } from './djiLogMeta'
import type { FlightMeta } from '../domain/types'

const base: FlightMeta = {
  id: 'dropped:x.txt',
  file: 'x.txt',
  version: 0,
  encrypted: false,
  hasKeychain: false,
  aircraftName: 'DROPPED LOG',
  aircraftSn: 'x.txt',
  startTime: '2020-01-01T00:00:00.000Z',
  durationS: 0,
  distanceKm: 0,
  maxHeightM: 0,
  maxSpeedMs: 0,
  recordCount: 0,
  home: { lon: 0, lat: 0 },
}

describe('classifyDecodeError', () => {
  // These are the literal strings the Rust parser produces. Verified against
  // the real library, not guessed.
  it('recognises a non-DJI file from the bad-magic backtrace', () => {
    expect(
      classifyDecodeError(
        new Error('Parse error: no variants matched at 0x0: Info: bad magic at 0x0: 102'),
      ),
    ).toBe('not-dji')
  })

  it('recognises a file too short to hold a header', () => {
    expect(classifyDecodeError(new Error('Error: failed to fill whole buffer'))).toBe('not-dji')
  })

  it('recognises an encrypted log with no keychain', () => {
    expect(classifyDecodeError(new Error('Keychain is required'))).toBe('needs-keychain')
  })

  it('falls back to unknown for anything else', () => {
    expect(classifyDecodeError(new Error('something else entirely'))).toBe('unknown')
  })

  it('handles a non-Error throw', () => {
    expect(classifyDecodeError('Keychain is required')).toBe('needs-keychain')
  })
})

describe('DECODE_ERROR_MESSAGE', () => {
  // The whole point of the classification: never show a Rust backtrace.
  it('gives a plain sentence for every kind', () => {
    for (const kind of ['not-dji', 'needs-keychain', 'unknown'] as const) {
      const msg = DECODE_ERROR_MESSAGE[kind]
      expect(msg.length).toBeGreaterThan(10)
      expect(msg).not.toMatch(/0x0|magic|backtrace|variants/i)
    }
  })
})

describe('metaFromDetails', () => {
  const details: RawDetails = {
    aircraftName: 'Matrice 400',
    aircraftSn: '1581F8DBW258U00A',
    startTime: '2026-02-17T06:27:04.690Z',
    totalTime: 2722.9,
    totalDistance: 22.07,
    maxHeight: 50,
    maxHorizontalSpeed: 17.04,
    recordLineCount: 27229,
    longitude: 48.004,
    latitude: 28.782,
  }

  // This is what makes a dropped log show its real identity instead of the
  // placeholder the caller had to guess before parsing.
  it('replaces guessed placeholders with what the log says', () => {
    const m = metaFromDetails(base, 14, details)
    expect(m.aircraftName).toBe('Matrice 400')
    expect(m.aircraftSn).toBe('1581F8DBW258U00A')
    expect(m.durationS).toBeCloseTo(2722.9)
    expect(m.distanceKm).toBeCloseTo(22.07)
    expect(m.recordCount).toBe(27229)
    expect(m.home).toEqual({ lon: 48.004, lat: 28.782 })
  })

  it('keeps the caller id and filename', () => {
    const m = metaFromDetails(base, 14, details)
    expect(m.id).toBe('dropped:x.txt')
    expect(m.file).toBe('x.txt')
  })

  it('derives encrypted from the version', () => {
    expect(metaFromDetails(base, 14, details).encrypted).toBe(true)
    expect(metaFromDetails(base, 12, details).encrypted).toBe(false)
  })

  it('falls back to the base values when details are absent', () => {
    const m = metaFromDetails(base, 14, null)
    expect(m.aircraftName).toBe('DROPPED LOG')
    expect(m.durationS).toBe(0)
  })

  it('ignores an empty aircraft name rather than blanking the display', () => {
    expect(metaFromDetails(base, 14, { ...details, aircraftName: '' }).aircraftName).toBe(
      'DROPPED LOG',
    )
  })

  it('rejects an unparseable start time', () => {
    expect(metaFromDetails(base, 14, { ...details, startTime: 'nonsense' }).startTime).toBe(
      base.startTime,
    )
  })
})
