// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFlightLoader } from './useFlightLoader'
import { useTelemetryStore } from '../store/telemetryStore'
import * as cache from '../io/flightCache'
import * as parse from '../io/parseFlight'
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
  recordCount: 1,
  home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = { meta, samples: [] }

const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  vi.restoreAllMocks()
  vi.spyOn(cache, 'getCachedPath').mockResolvedValue(null)
  vi.spyOn(cache, 'putCachedPath').mockResolvedValue()
  vi.spyOn(parse, 'decodeFlight').mockResolvedValue({ meta, path, locked: false })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      json: () => Promise.resolve([{ k: 1 }]),
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('openFlight', () => {
  it('serves a cached path without fetching', async () => {
    vi.mocked(cache.getCachedPath).mockResolvedValue(path)
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(fetch).not.toHaveBeenCalled()
    expect(useTelemetryStore.getState().path).toBe(path)
  })

  it('fetches the log and its keychain on a cache miss', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.endsWith('flights/a.txt'))).toBe(true)
    expect(urls.some((u) => u.endsWith('flights/a.keychain.json'))).toBe(true)
  })

  it('caches the decoded path', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(cache.putCachedPath).toHaveBeenCalledWith(path)
  })

  it('selects the flight and clears loading on success', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    const s = useTelemetryStore.getState()
    expect(s.selectedId).toBe('a')
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  // An unkeyed v13+ flight is not an error: FramePanel renders the summary
  // and FRAMES LOCKED from the metadata alone (spec section 9).
  it('skips decoding entirely for a flight with no keychain', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight({ ...meta, hasKeychain: false }))
    expect(parse.decodeFlight).not.toHaveBeenCalled()
    const s = useTelemetryStore.getState()
    expect(s.path).toBeNull()
    expect(s.error).toBeNull()
    expect(s.loading).toBe(false)
  })

  it('decodes without a keychain for a pre-v13 log', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight({ ...meta, version: 12, encrypted: false }))
    expect(vi.mocked(parse.decodeFlight).mock.calls[0][1]).toBeNull()
  })

  it('surfaces a decode failure as an error', async () => {
    vi.mocked(parse.decodeFlight).mockRejectedValue(new Error('bad keychain'))
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(useTelemetryStore.getState().error).toMatch(/bad keychain/)
  })

  it('surfaces a failed log fetch as an error', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(useTelemetryStore.getState().error).toBeTruthy()
    expect(useTelemetryStore.getState().loading).toBe(false)
  })
})

describe('openDroppedFile', () => {
  function file(name = 'flight.txt') {
    const f = new File(['abc'], name)
    f.arrayBuffer = () => Promise.resolve(new ArrayBuffer(8))
    return f
  }

  it('adds the dropped flight to the session list and selects it', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openDroppedFile(file()))
    const s = useTelemetryStore.getState()
    expect(s.sessionFlights).toHaveLength(1)
    expect(s.selectedId).toBe(s.sessionFlights[0].id)
  })

  it('reports a file that is not a DJI flight record', async () => {
    vi.mocked(parse.decodeFlight).mockRejectedValue(new Error('not a dji log'))
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openDroppedFile(file()))
    expect(useTelemetryStore.getState().error).toBeTruthy()
  })
})
