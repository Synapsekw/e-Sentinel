import { describe, it, expect, beforeEach } from 'vitest'
import { selectVisibleFlights, useTelemetryStore } from './telemetryStore'
import { NO_FILTERS } from '../domain/types'
import type { FlightMeta, FlightPath } from '../domain/types'

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
  recordCount: 2,
  home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    {
      t: 0,
      lon: 48,
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
    },
    {
      t: 30,
      lon: 48.01,
      lat: 28.79,
      alt: 90,
      height: 50,
      speedH: 5,
      speedV: 0,
      heading: 90,
      gimbalPitch: -30,
      battery: 80,
      voltage: 49,
      sats: 32,
      mode: 'GPSWaypoint',
    },
  ],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))

describe('telemetryStore', () => {
  it('starts empty and idle', () => {
    const s = useTelemetryStore.getState()
    expect(s.catalog).toEqual([])
    expect(s.selectedId).toBeNull()
    expect(s.playing).toBe(false)
    expect(s.rate).toBe(1)
    expect(s.filters).toEqual(NO_FILTERS)
    expect(s.sort).toBe('newest')
  })

  it('stores a loaded catalog', () => {
    useTelemetryStore.getState().setCatalog([meta])
    expect(useTelemetryStore.getState().catalog).toHaveLength(1)
  })

  it('merges session flights ahead of the baked catalog', () => {
    useTelemetryStore.getState().setCatalog([meta])
    useTelemetryStore.getState().addSessionFlight({ ...meta, id: 'dropped' })
    expect(selectVisibleFlights(useTelemetryStore.getState()).map((f) => f.id)).toEqual([
      'dropped',
      'a',
    ])
  })

  it('applies filters and sort to the visible list', () => {
    useTelemetryStore.getState().setCatalog([meta, { ...meta, id: 'b', aircraftSn: 'SN2' }])
    useTelemetryStore.getState().setFilters({ ...NO_FILTERS, aircraftSn: 'SN2' })
    expect(selectVisibleFlights(useTelemetryStore.getState()).map((f) => f.id)).toEqual(['b'])
  })

  it('clears session drop-ins', () => {
    useTelemetryStore.getState().addSessionFlight({ ...meta, id: 'dropped' })
    useTelemetryStore.getState().clearSessionFlights()
    expect(useTelemetryStore.getState().sessionFlights).toEqual([])
  })

  it('resets the cursor and playback when a path is loaded', () => {
    useTelemetryStore.setState({ cursorT: 99, playing: true })
    useTelemetryStore.getState().setPath(path)
    const s = useTelemetryStore.getState()
    expect(s.cursorT).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.path?.meta.id).toBe('a')
  })

  it('clamps the cursor to the path duration', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(999)
    expect(useTelemetryStore.getState().cursorT).toBe(30)
    useTelemetryStore.getState().setCursor(-5)
    expect(useTelemetryStore.getState().cursorT).toBe(0)
  })

  it('stops playback when the cursor reaches the end', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.setState({ playing: true })
    useTelemetryStore.getState().setCursor(30)
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  it('rewinds to the start when play is pressed at the end', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(30)
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().cursorT).toBe(0)
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('does not play with no path loaded', () => {
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  it('cycles the playback rate through 1, 4 and 16', () => {
    // Called directly off getState(), not destructured into a standalone
    // binding: TelemetryState declares its setters with method-shorthand
    // signatures, so pulling cycleRate out into its own binding trips
    // @typescript-eslint/unbound-method (see planner/ui/PlanTree.tsx for the
    // same pattern).
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(4)
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(16)
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(1)
  })

  it('records a load error and clears loading', () => {
    useTelemetryStore.setState({ loading: true })
    useTelemetryStore.getState().setError('Not a DJI flight record')
    const s = useTelemetryStore.getState()
    expect(s.error).toBe('Not a DJI flight record')
    expect(s.loading).toBe(false)
    expect(s.path).toBeNull()
  })

  it('clears the previous error when a new flight is selected', () => {
    useTelemetryStore.getState().setError('boom')
    useTelemetryStore.getState().select('a')
    const s = useTelemetryStore.getState()
    expect(s.error).toBeNull()
    expect(s.selectedId).toBe('a')
  })
})
