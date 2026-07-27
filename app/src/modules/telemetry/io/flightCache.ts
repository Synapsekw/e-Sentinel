// IndexedDB cache for decoded flight paths. Stores NORMALIZED paths only --
// a raw DJI Frame[] is 65MB for a 27k-record log (spec section 3.6), while
// the normalized form is roughly 2.5MB.
//
// Every function here swallows its errors and degrades to "no cache". A
// blocked IndexedDB (private browsing) must cost a 414ms re-decode, never a
// broken module.

import { NORMALIZER_VERSION } from '../domain/types'
import type { FlightMeta, FlightPath } from '../domain/types'

const DB_NAME = 'sentinel-telemetry'
const DB_VERSION = 1
const STORE = 'paths'

interface CacheRecord {
  id: string
  v: number
  path: FlightPath
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = work(tx.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
        } catch {
          db.close()
          resolve(null)
        }
      }),
  )
}

export async function getCachedPath(id: string): Promise<FlightPath | null> {
  const rec = await run<CacheRecord | undefined>(
    'readonly',
    (s) => s.get(id) as IDBRequest<CacheRecord | undefined>,
  )
  if (!rec) return null
  // A normalizer bump changes the shape of every sample; a stale entry is
  // worse than no entry.
  if (rec.v !== NORMALIZER_VERSION) return null
  return rec.path
}

export async function putCachedPath(path: FlightPath): Promise<void> {
  await run('readwrite', (s) =>
    s.put({ id: path.meta.id, v: NORMALIZER_VERSION, path } satisfies CacheRecord),
  )
}

export async function listCachedPaths(): Promise<FlightMeta[]> {
  const all = await run<CacheRecord[]>('readonly', (s) => s.getAll() as IDBRequest<CacheRecord[]>)
  if (!all) return []
  return all.filter((r) => r.v === NORMALIZER_VERSION).map((r) => r.path.meta)
}

export async function clearCache(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}
