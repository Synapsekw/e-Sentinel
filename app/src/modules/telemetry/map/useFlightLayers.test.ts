// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useFlightLayers } from './useFlightLayers'
import { TELEMETRY_SOURCES } from './telemetryStyle'
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

// Returns a maplibre-gl Map stand-in alongside standalone references to its
// getSource/setData mocks. Tests assert on `getSource`/`setData` directly
// rather than `map.getSource` — reading a vi.fn() through a property typed
// via maplibre-gl's Map class trips @typescript-eslint/unbound-method (it
// can't tell a mock apart from a real bound method), where a plain local
// variable holding the same mock doesn't (see selectEntity.test.ts's
// fakeMap for the same pattern).
function fakeMap() {
  const setData = vi.fn()
  // isMapUsable probes for a truthy `style`. The explicit signature keeps
  // `getSource.mock.calls[n][0]` typed as the source id string, matching
  // maplibre-gl's Map.getSource(id) without needing a cast at each call site.
  const getSource = vi.fn<(id: string) => { setData: typeof setData }>(() => ({ setData }))
  return { setData, getSource, map: { style: {}, getSource } as unknown as maplibregl.Map }
}

function renderLayers(map: maplibregl.Map | null, ready: boolean, p: FlightPath | null, t: number) {
  return renderHook(
    (props: { p: FlightPath | null; t: number }) => {
      const ref: MutableRefObject<maplibregl.Map | null> = useRef(map)
      useFlightLayers(ref, ready, props.p, props.t)
    },
    { initialProps: { p, t } },
  )
}

afterEach(() => cleanup())
beforeEach(() => vi.useRealTimers())

describe('useFlightLayers', () => {
  it('does nothing before the map is ready', () => {
    const { map, setData } = fakeMap()
    renderLayers(map, false, path, 0)
    expect(setData).not.toHaveBeenCalled()
  })

  it('does nothing with a null map', () => {
    expect(() => renderLayers(null, true, path, 0)).not.toThrow()
  })

  // Route unmount removes the map parent-first, so a hook that reaches for a
  // torn-down instance throws. Same guard planner hooks use.
  it('does nothing once the map has been removed', () => {
    const { setData } = fakeMap()
    const dead = { style: null, getSource: vi.fn() } as unknown as maplibregl.Map
    renderLayers(dead, true, path, 0)
    expect(setData).not.toHaveBeenCalled()
  })

  it('feeds the full path and home sources when a path loads', () => {
    const { map, getSource } = fakeMap()
    renderLayers(map, true, path, 0)
    const asked = getSource.mock.calls.map((c) => c[0])
    expect(asked).toContain(TELEMETRY_SOURCES.path)
    expect(asked).toContain(TELEMETRY_SOURCES.home)
  })

  it('clears every source when the path becomes null', () => {
    const { map, setData } = fakeMap()
    const { rerender } = renderLayers(map, true, path, 0)
    setData.mockClear()
    rerender({ p: null, t: 0 })
    const cleared = setData.mock.calls.map((c) => c[0] as { features: unknown[] })
    expect(cleared.length).toBeGreaterThan(0)
    expect(cleared.every((fc) => fc.features.length === 0)).toBe(true)
  })

  // The full path is 27k coordinates. Rebuilding it on every cursor tick
  // would re-tile the whole line 60 times a second; only the traversed line
  // and position marker may follow the cursor.
  it('does not rebuild the full path when only the cursor moves', () => {
    const { map, getSource } = fakeMap()
    const { rerender } = renderLayers(map, true, path, 0)
    getSource.mockClear()
    rerender({ p: path, t: 15 })
    const asked = getSource.mock.calls.map((c) => c[0])
    expect(asked).not.toContain(TELEMETRY_SOURCES.path)
    expect(asked).toContain(TELEMETRY_SOURCES.traversed)
  })
})
