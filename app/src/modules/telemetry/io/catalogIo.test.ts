import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCatalog, fetchCatalog } from './catalogIo'

const validFlight = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 2722.9,
  distanceKm: 22.07,
  maxHeightM: 50,
  maxSpeedMs: 17.04,
  recordCount: 27229,
  home: { lon: 48.004, lat: 28.782 },
}

describe('parseCatalog', () => {
  it('accepts a well-formed catalog', () => {
    expect(parseCatalog({ version: 1, flights: [validFlight] })?.flights).toHaveLength(1)
  })

  it('accepts an empty flight list', () => {
    expect(parseCatalog({ version: 1, flights: [] })?.flights).toEqual([])
  })

  it('rejects a null or non-object payload', () => {
    expect(parseCatalog(null)).toBeNull()
    expect(parseCatalog('nope')).toBeNull()
  })

  it('rejects an unknown catalog version', () => {
    expect(parseCatalog({ version: 2, flights: [] })).toBeNull()
  })

  it('rejects a missing flights array', () => {
    expect(parseCatalog({ version: 1 })).toBeNull()
  })

  // Element-level validation, matching the planner's parsePlan precedent:
  // a malformed element must not be admitted just because the envelope is
  // well-formed.
  it('drops malformed flight entries but keeps valid ones', () => {
    const result = parseCatalog({ version: 1, flights: [validFlight, { id: 'bad' }] })
    expect(result?.flights.map((f) => f.id)).toEqual(['a'])
  })

  it('drops an entry whose home point is not numeric', () => {
    const bad = { ...validFlight, id: 'b', home: { lon: 'x', lat: 28 } }
    expect(parseCatalog({ version: 1, flights: [bad] })?.flights).toEqual([])
  })
})

describe('fetchCatalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed catalog on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: 1, flights: [validFlight] }),
      }),
    )
    const result = await fetchCatalog('/base/')
    expect(result.flights).toHaveLength(1)
  })

  it('requests index.json under the given base', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: 1, flights: [] }) })
    vi.stubGlobal('fetch', spy)
    await fetchCatalog('/e-Sentinel/')
    expect(spy).toHaveBeenCalledWith('/e-Sentinel/flights/index.json')
  })

  it('returns an empty catalog when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect((await fetchCatalog('/')).flights).toEqual([])
  })

  it('returns an empty catalog when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await fetchCatalog('/')).flights).toEqual([])
  })

  it('returns an empty catalog when the payload is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ nope: true }) }),
    )
    expect((await fetchCatalog('/')).flights).toEqual([])
  })
})
