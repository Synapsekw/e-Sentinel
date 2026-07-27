import { describe, it, expect } from 'vitest'
import { normalizeFrames } from './normalizeFrames'
import type { RawFrame } from './normalizeFrames'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30,
  distanceKm: 1,
  maxHeightM: 100,
  maxSpeedMs: 10,
  recordCount: 3,
  home: { lon: 48, lat: 28.78 },
}

function raw(dateTime: string, over: Partial<RawFrame['osd']> = {}): RawFrame {
  return {
    custom: { dateTime },
    osd: {
      latitude: 28.78,
      longitude: 48.0,
      altitude: 90,
      height: 50,
      xSpeed: 3,
      ySpeed: 4,
      zSpeed: -1,
      yaw: 116.9,
      gpsNum: 32,
      flycState: 'GPSWaypoint',
      ...over,
    },
    gimbal: { pitch: -30 },
    battery: { chargeLevel: 67, voltage: 50.067 },
  }
}

describe('normalizeFrames', () => {
  it('returns an empty path for no frames', () => {
    expect(normalizeFrames([], meta).samples).toEqual([])
  })

  it('carries the meta through unchanged', () => {
    expect(normalizeFrames([raw('2026-02-17T06:27:04.690Z')], meta).meta).toBe(meta)
  })

  // t is derived from the frame clock relative to the FIRST frame, not from
  // osd.flyTime: flyTime is not populated consistently across DJI firmware,
  // and the scrubber's whole contract is that t=0 is the start of the log.
  it('makes t relative to the first frame', () => {
    const path = normalizeFrames(
      [raw('2026-02-17T06:27:04.000Z'), raw('2026-02-17T06:27:14.500Z')],
      meta,
    )
    expect(path.samples[0].t).toBe(0)
    expect(path.samples[1].t).toBeCloseTo(10.5)
  })

  it('maps position, altitude and height', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z')], meta).samples[0]
    expect(s.lon).toBe(48.0)
    expect(s.lat).toBe(28.78)
    expect(s.alt).toBe(90)
    expect(s.height).toBe(50)
  })

  // DJI gives horizontal velocity as separate x/y components; the readout
  // wants a single ground speed.
  it('derives horizontal speed from the x and y components', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z', { xSpeed: 3, ySpeed: 4 })], meta)
      .samples[0]
    expect(s.speedH).toBeCloseTo(5)
  })

  it('takes vertical speed from zSpeed', () => {
    expect(
      normalizeFrames([raw('2026-02-17T06:27:04Z', { zSpeed: -1 })], meta).samples[0].speedV,
    ).toBe(-1)
  })

  it('maps battery, gimbal, satellites and mode', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z')], meta).samples[0]
    expect(s.battery).toBe(67)
    expect(s.voltage).toBeCloseTo(50.067)
    expect(s.gimbalPitch).toBe(-30)
    expect(s.sats).toBe(32)
    expect(s.mode).toBe('GPSWaypoint')
  })

  it('falls back to UNKNOWN for an absent flight mode', () => {
    const f = raw('2026-02-17T06:27:04Z')
    delete (f.osd as Record<string, unknown>).flycState
    expect(normalizeFrames([f], meta).samples[0].mode).toBe('UNKNOWN')
  })

  // DJI emits flycState as either a plain string or a { Unknown: n } object
  // depending on whether the enum value is recognised.
  it('renders an unrecognised flight mode object as UNKNOWN', () => {
    const f = raw('2026-02-17T06:27:04Z', { flycState: { Unknown: 42 } })
    expect(normalizeFrames([f], meta).samples[0].mode).toBe('UNKNOWN')
  })

  // Pre-GPS-lock frames at the very start of a log carry 0,0. Plotting them
  // draws a line from the Gulf of Guinea to Kuwait across the whole map.
  it('drops frames with no GPS fix', () => {
    const path = normalizeFrames(
      [raw('2026-02-17T06:27:04Z', { latitude: 0, longitude: 0 }), raw('2026-02-17T06:27:05Z')],
      meta,
    )
    expect(path.samples).toHaveLength(1)
  })

  it('drops frames with an unparseable timestamp', () => {
    expect(normalizeFrames([raw('nonsense')], meta).samples).toEqual([])
  })

  it('substitutes zero for a missing numeric field rather than emitting NaN', () => {
    const f = raw('2026-02-17T06:27:04Z')
    delete (f.battery as Record<string, unknown>).voltage
    expect(normalizeFrames([f], meta).samples[0].voltage).toBe(0)
  })
})

// Regression tests for corrupt clocks. Real DJI logs contain them: the
// 5,049-frame m400-2026-02-17-0846 log carries one frame stamped 2095-04-15
// and one stamped 2012-05-04 among frames otherwise all on 2026-02-17. They
// are valid dates, so the finite check does not catch them, and left in they
// freeze traversedCoords partway through the flight and break sampleAt's
// binary search. Found by running the real log through, not by fixtures.
describe('normalizeFrames with corrupt timestamps', () => {
  it('drops a frame stamped far in the future', () => {
    const path = normalizeFrames(
      [
        raw('2026-02-17T06:27:04.000Z'),
        raw('2095-04-15T15:16:56.476Z'),
        raw('2026-02-17T06:27:06.000Z'),
      ],
      meta,
    )
    expect(path.samples).toHaveLength(2)
    expect(path.samples.map((s) => s.t)).toEqual([0, 2])
  })

  it('drops a frame stamped far in the past', () => {
    const path = normalizeFrames(
      [
        raw('2026-02-17T06:27:04.000Z'),
        raw('2012-05-04T21:40:06.158Z'),
        raw('2026-02-17T06:27:06.000Z'),
      ],
      meta,
    )
    expect(path.samples).toHaveLength(2)
  })

  // The median anchor exists for this case: anchoring on the first frame
  // would make every good frame look corrupt and empty the whole log.
  it('survives a corrupt FIRST frame', () => {
    const path = normalizeFrames(
      [
        raw('2095-04-15T15:16:56.476Z'),
        raw('2026-02-17T06:27:04.000Z'),
        raw('2026-02-17T06:27:05.000Z'),
        raw('2026-02-17T06:27:06.000Z'),
      ],
      meta,
    )
    expect(path.samples).toHaveLength(3)
    expect(path.samples[0].t).toBe(0)
  })

  it('always emits samples in non-decreasing time order', () => {
    const path = normalizeFrames(
      [
        raw('2026-02-17T06:27:04.000Z'),
        raw('2026-02-17T06:27:08.000Z'),
        raw('2026-02-17T06:27:06.000Z'),
        raw('2026-02-17T06:27:10.000Z'),
      ],
      meta,
    )
    const ts = path.samples.map((s) => s.t)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
  })

  it('returns an empty path when every frame has a corrupt clock spread', () => {
    expect(normalizeFrames([raw('nonsense'), raw('also nonsense')], meta).samples).toEqual([])
  })
})
