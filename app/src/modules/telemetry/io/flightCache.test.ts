import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getCachedPath, putCachedPath, listCachedPaths, clearCache } from './flightCache'
import { NORMALIZER_VERSION } from '../domain/types'
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

const path: FlightPath = {
  meta,
  samples: [
    {
      t: 0,
      lon: 48,
      lat: 28.78,
      alt: 90,
      height: 50,
      speedH: 5,
      speedV: 0,
      heading: 117,
      gimbalPitch: -30,
      battery: 67,
      voltage: 50,
      sats: 32,
      mode: 'GPSWaypoint',
    },
  ],
}

beforeEach(async () => {
  await clearCache()
})

describe('flightCache', () => {
  it('returns null for an id never stored', async () => {
    expect(await getCachedPath('missing')).toBeNull()
  })

  it('round-trips a stored path', async () => {
    await putCachedPath(path)
    const got = await getCachedPath('a')
    expect(got?.samples[0].mode).toBe('GPSWaypoint')
    expect(got?.meta.aircraftSn).toBe('SN1')
  })

  it('overwrites an existing entry for the same id', async () => {
    await putCachedPath(path)
    await putCachedPath({ ...path, samples: [] })
    expect((await getCachedPath('a'))?.samples).toEqual([])
  })

  // A normalizer change alters the shape of every sample. Serving a stale
  // entry after such a change is worse than re-decoding, which costs 414ms.
  //
  // Simplified from the task doc: rather than reopening the database
  // directly (which required a pointless `vi.spyOn` on a module getter that
  // did nothing useful), this plants the stale record by writing straight
  // through fake-indexeddb with a hand-set `v`. Behaviour under test is
  // unchanged -- getCachedPath must reject a version mismatch.
  it('ignores an entry written under an older normalizer version', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('sentinel-telemetry', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('paths')) {
          req.result.createObjectStore('paths', { keyPath: 'id' })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('paths', 'readwrite')
        tx.objectStore('paths').put({ id: 'a', v: NORMALIZER_VERSION - 1, path })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(new Error(String(tx.error)))
      }
      req.onerror = () => reject(new Error(String(req.error)))
    })
    expect(await getCachedPath('a')).toBeNull()
  })

  it('lists the metadata of every cached path', async () => {
    await putCachedPath(path)
    await putCachedPath({ ...path, meta: { ...meta, id: 'b' } })
    const ids = (await listCachedPaths()).map((m) => m.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('clears everything', async () => {
    await putCachedPath(path)
    await clearCache()
    expect(await getCachedPath('a')).toBeNull()
  })
})

describe('flightCache without IndexedDB', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Private browsing blocks IndexedDB entirely. The module must degrade to
  // "decode every time", never fail (spec section 9).
  it('returns null instead of throwing when indexedDB is absent', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(await getCachedPath('a')).toBeNull()
  })

  it('resolves silently when a put cannot be stored', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(putCachedPath(path)).resolves.toBeUndefined()
  })
})
