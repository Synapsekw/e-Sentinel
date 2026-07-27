// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { usePlayback } from './usePlayback'
import { useTelemetryStore } from '../store/telemetryStore'
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
  durationS: 100,
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
      t: 100,
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

// Drives rAF by hand so the loop is deterministic instead of wall-clock bound.
let frame: ((t: number) => void) | null = null
const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  frame = null
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function tick(ms: number) {
  act(() => frame?.(ms))
}

describe('usePlayback', () => {
  it('does not advance the cursor while paused', () => {
    useTelemetryStore.getState().setPath(path)
    renderHook(() => usePlayback())
    tick(0)
    tick(1000)
    expect(useTelemetryStore.getState().cursorT).toBe(0)
  })

  it('advances the cursor in real time at 1x', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    renderHook(() => usePlayback())
    tick(0)
    tick(2000)
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(2, 1)
  })

  // A 45-minute survey flight at 1x is unwatchable in a meeting; 16x is what
  // makes the replay demo-length.
  it('advances 16x faster at rate 16', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    useTelemetryStore.setState({ rate: 16 })
    renderHook(() => usePlayback())
    tick(0)
    tick(1000)
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(16, 1)
  })

  it('stops at the end of the flight', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    useTelemetryStore.setState({ rate: 16 })
    renderHook(() => usePlayback())
    tick(0)
    tick(100000)
    const s = useTelemetryStore.getState()
    expect(s.cursorT).toBe(100)
    expect(s.playing).toBe(false)
  })
})
