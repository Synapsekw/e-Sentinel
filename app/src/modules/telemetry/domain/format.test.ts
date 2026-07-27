import { describe, it, expect } from 'vitest'
import {
  fmtFlightClock,
  fmtDuration,
  fmtDate,
  fmtKm,
  fmtMeters,
  fmtSpeed,
  fmtHeading,
} from './format'

describe('fmtFlightClock', () => {
  it('formats as T+MM:SS', () => {
    expect(fmtFlightClock(0)).toBe('T+00:00')
    expect(fmtFlightClock(862)).toBe('T+14:22')
  })

  it('rolls past an hour without an hours field', () => {
    expect(fmtFlightClock(3661)).toBe('T+61:01')
  })

  it('clamps negatives to zero', () => {
    expect(fmtFlightClock(-5)).toBe('T+00:00')
  })
})

describe('fmtDuration', () => {
  it('formats minutes and seconds', () => {
    expect(fmtDuration(2722.9)).toBe('45m 23s')
    expect(fmtDuration(1009.6)).toBe('16m 50s')
  })

  it('omits minutes under a minute', () => {
    expect(fmtDuration(42)).toBe('42s')
  })
})

describe('fmtDate', () => {
  it('formats an ISO timestamp as UTC date and time', () => {
    expect(fmtDate('2026-02-17T06:27:04.690Z')).toBe('2026-02-17 06:27')
  })

  it('returns a dash for an unparseable value', () => {
    expect(fmtDate('nonsense')).toBe('—')
  })
})

describe('numeric formatters', () => {
  it('formats kilometres to one decimal', () => {
    expect(fmtKm(22.071382)).toBe('22.1 km')
  })

  it('formats metres as a whole number', () => {
    expect(fmtMeters(49.9000015)).toBe('50 m')
  })

  it('formats speed to one decimal', () => {
    expect(fmtSpeed(17.0425949)).toBe('17.0 m/s')
  })

  it('formats heading zero-padded to three digits', () => {
    expect(fmtHeading(9)).toBe('009°')
    expect(fmtHeading(116.9)).toBe('117°')
  })

  // DJI yaw is signed, -180..180; compass headings are 0..359.
  it('normalises negative headings into 0..359', () => {
    expect(fmtHeading(-90)).toBe('270°')
  })
})
