import { describe, it, expect } from 'vitest'
import { sampleAt, pathBounds, distanceFromHomeM, traversedCoords, allCoords } from './flightPath'
import type { FlightMeta, FlightPath, FlightSample } from './types'

const meta: FlightMeta = {
  id: 'test',
  file: 'test.txt',
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
  recordCount: 4,
  home: { lon: 48.0, lat: 28.78 },
}

function sample(over: Partial<FlightSample>): FlightSample {
  return {
    t: 0,
    lon: 48.0,
    lat: 28.78,
    alt: 0,
    height: 0,
    speedH: 0,
    speedV: 0,
    heading: 0,
    gimbalPitch: 0,
    battery: 100,
    voltage: 50,
    sats: 20,
    mode: 'GPSAtti',
    ...over,
  }
}

const path: FlightPath = {
  meta,
  samples: [
    sample({
      t: 0,
      lon: 48.0,
      lat: 28.78,
      height: 0,
      battery: 100,
      heading: 10,
      mode: 'AutoTakeoff',
    }),
    sample({
      t: 10,
      lon: 48.01,
      lat: 28.79,
      height: 50,
      battery: 90,
      heading: 350,
      mode: 'GPSWaypoint',
    }),
    sample({
      t: 20,
      lon: 48.02,
      lat: 28.8,
      height: 100,
      battery: 80,
      heading: 180,
      mode: 'GPSWaypoint',
    }),
  ],
}

describe('sampleAt', () => {
  it('returns null for an empty path', () => {
    expect(sampleAt({ meta, samples: [] }, 5)).toBeNull()
  })

  it('clamps below the first sample', () => {
    expect(sampleAt(path, -10)?.height).toBe(0)
  })

  it('clamps above the last sample', () => {
    expect(sampleAt(path, 999)?.height).toBe(100)
  })

  it('returns an exact sample on a boundary', () => {
    expect(sampleAt(path, 10)?.height).toBe(50)
  })

  it('interpolates continuous fields between samples', () => {
    const s = sampleAt(path, 5)
    expect(s?.height).toBeCloseTo(25)
    expect(s?.battery).toBeCloseTo(95)
    expect(s?.lon).toBeCloseTo(48.005)
  })

  // Heading is circular: interpolating 10 -> 350 linearly sweeps the long way
  // round through 180, which would spin the map marker backwards through a
  // half turn. Nearest-sample is correct and cheap; the same applies to the
  // discrete fields (mode, sats).
  it('takes heading from the nearest sample rather than interpolating', () => {
    expect(sampleAt(path, 1)?.heading).toBe(10)
    expect(sampleAt(path, 9)?.heading).toBe(350)
  })

  it('takes mode from the nearest sample', () => {
    expect(sampleAt(path, 1)?.mode).toBe('AutoTakeoff')
    expect(sampleAt(path, 9)?.mode).toBe('GPSWaypoint')
  })
})

describe('pathBounds', () => {
  it('returns null for an empty path', () => {
    expect(pathBounds({ meta, samples: [] })).toBeNull()
  })

  it('returns southwest and northeast corners', () => {
    expect(pathBounds(path)).toEqual([
      [48.0, 28.78],
      [48.02, 28.8],
    ])
  })
})

describe('distanceFromHomeM', () => {
  it('is zero at the home point', () => {
    expect(distanceFromHomeM(path.samples[0], meta.home)).toBeCloseTo(0, 1)
  })

  // 0.01 degrees of latitude is ~1113m; the sample is offset in both axes.
  it('grows with distance', () => {
    const d = distanceFromHomeM(path.samples[1], meta.home)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(2000)
  })
})

describe('traversedCoords', () => {
  it('is empty before the first sample', () => {
    expect(traversedCoords(path, -1)).toEqual([])
  })

  it('includes only samples up to the cursor', () => {
    expect(traversedCoords(path, 10)).toEqual([
      [48.0, 28.78],
      [48.01, 28.79],
    ])
  })

  it('includes every sample past the end', () => {
    expect(traversedCoords(path, 999)).toHaveLength(3)
  })
})

describe('allCoords', () => {
  it('returns every coordinate pair', () => {
    expect(allCoords(path)).toHaveLength(3)
    expect(allCoords(path)[2]).toEqual([48.02, 28.8])
  })
})
