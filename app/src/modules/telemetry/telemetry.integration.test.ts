// End-to-end over the pure layers: catalog validation -> filtering ->
// store selection -> path query -> map features. Deliberately no React and
// no WASM; the fixture is a dozen hand-written samples, never a real 9MB log.

import { describe, it, expect, beforeEach } from 'vitest'
import { parseCatalog } from './io/catalogIo'
import { normalizeFrames } from './io/normalizeFrames'
import type { RawFrame } from './io/normalizeFrames'
import { filterFlights, sortFlights } from './domain/filters'
import { sampleAt, pathBounds } from './domain/flightPath'
import { pathFeature, traversedFeature } from './map/telemetryStyle'
import { selectVisibleFlights, useTelemetryStore } from './store/telemetryStore'
import { NO_FILTERS } from './domain/types'

const rawCatalog = {
  version: 1,
  flights: [
    {
      id: 'm400-2026-02-17-0627',
      file: 'm400-2026-02-17-0627.txt',
      version: 14,
      encrypted: true,
      hasKeychain: true,
      aircraftName: 'Matrice 400',
      // maxHeightM is 104, NOT 50: a sample height of 49.9 also renders '50 m',
      // and getByText then matches two elements. The point of this test is that
      // the summary and the readouts show different numbers from different
      // sources.
      aircraftSn: '1581F8DBW258U00A',
      startTime: '2026-02-17T06:27:04.690Z',
      durationS: 2722.9,
      distanceKm: 22.07,
      maxHeightM: 104,
      maxSpeedMs: 17.04,
      recordCount: 27229,
      home: { lon: 48.004, lat: 28.782 },
    },
    {
      id: 'm400-2026-02-17-0846',
      file: 'm400-2026-02-17-0846.txt',
      version: 14,
      encrypted: true,
      hasKeychain: true,
      aircraftName: 'Matrice 400',
      aircraftSn: '1581F5FKC257P00D',
      startTime: '2026-02-17T08:46:26.746Z',
      durationS: 1009.6,
      distanceKm: 6.01,
      maxHeightM: 50,
      maxSpeedMs: 15.13,
      recordCount: 5050,
      home: { lon: 48.004, lat: 28.782 },
    },
    { id: 'broken' },
  ],
}

function frame(secs: number, lon: number, lat: number): RawFrame {
  return {
    custom: {
      dateTime: new Date(Date.parse('2026-02-17T06:27:04.000Z') + secs * 1000).toISOString(),
    },
    osd: {
      latitude: lat,
      longitude: lon,
      altitude: 430 + secs,
      height: secs,
      xSpeed: 3,
      ySpeed: 4,
      zSpeed: 1,
      yaw: 90,
      gpsNum: 32,
      flycState: 'GPSWaypoint',
    },
    gimbal: { pitch: -30 },
    battery: { chargeLevel: 100 - secs, voltage: 50 },
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))

describe('telemetry end to end', () => {
  it('carries a catalog through validation, filtering and selection', () => {
    const catalog = parseCatalog(rawCatalog)
    expect(catalog).not.toBeNull()
    if (!catalog) throw new Error('expected catalog')
    // The malformed third entry is dropped, the two real ones survive.
    expect(catalog.flights).toHaveLength(2)

    useTelemetryStore.getState().setCatalog(catalog.flights)
    useTelemetryStore.getState().setFilters({ ...NO_FILTERS, aircraftSn: '1581F5FKC257P00D' })
    const visible = selectVisibleFlights(useTelemetryStore.getState())
    expect(visible.map((f) => f.id)).toEqual(['m400-2026-02-17-0846'])
  })

  it('sorts the real catalog newest first', () => {
    const catalog = parseCatalog(rawCatalog)
    if (!catalog) throw new Error('expected catalog')
    const flights = catalog.flights
    expect(sortFlights(flights, 'newest')[0].id).toBe('m400-2026-02-17-0846')
    expect(sortFlights(flights, 'distance')[0].id).toBe('m400-2026-02-17-0627')
    expect(filterFlights(flights, { ...NO_FILTERS, minDurationS: 2000 })).toHaveLength(1)
  })

  it('normalizes frames and drives the map from the cursor', () => {
    const catalog = parseCatalog(rawCatalog)
    if (!catalog) throw new Error('expected catalog')
    const meta = catalog.flights[0]
    const frames = [frame(0, 48.0, 28.78), frame(10, 48.005, 28.785), frame(20, 48.01, 28.79)]
    const path = normalizeFrames(frames, meta)
    expect(path.samples).toHaveLength(3)

    useTelemetryStore.getState().setPath(path)
    expect(useTelemetryStore.getState().cursorT).toBe(0)

    useTelemetryStore.getState().setCursor(15)
    const s = sampleAt(path, useTelemetryStore.getState().cursorT)
    expect(s?.height).toBeCloseTo(15)
    expect(s?.mode).toBe('GPSWaypoint')

    expect(pathBounds(path)).toEqual([
      [48.0, 28.78],
      [48.01, 28.79],
    ])
    expect(pathFeature(path).features).toHaveLength(1)
    // Two of three samples are behind a 15s cursor.
    const traversed = traversedFeature(path, 15).features[0].geometry
    expect(traversed.coordinates).toHaveLength(2)
  })

  it('stops playback when the cursor is driven past the end', () => {
    const catalog = parseCatalog(rawCatalog)
    if (!catalog) throw new Error('expected catalog')
    const meta = catalog.flights[0]
    const path = normalizeFrames([frame(0, 48, 28.78), frame(20, 48.01, 28.79)], meta)
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().playing).toBe(true)
    useTelemetryStore.getState().setCursor(999)
    expect(useTelemetryStore.getState().playing).toBe(false)
    expect(useTelemetryStore.getState().cursorT).toBe(20)
  })
})
