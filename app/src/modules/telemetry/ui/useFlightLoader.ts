// Opening a flight: cache, then fetch, then decode. Every failure path here
// lands in the store as an error string rather than a throw -- spec section
// 9's rule that the library stays usable whatever one flight does.

import { useCallback } from 'react'
import { decodeFlight } from '../io/parseFlight'
import { getCachedPath, putCachedPath } from '../io/flightCache'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta } from '../domain/types'

const BASE = import.meta.env.BASE_URL

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load flight log (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

async function fetchKeychains(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as unknown[]
  } catch {
    return null
  }
}

// A dropped file has no catalog entry, so it gets a provisional one. The real
// aircraft and totals are unknown until the log is decoded; the worker
// returns the meta it was given, so these placeholders are what the summary
// shows for a drop-in. That is a known, accepted limitation of the drop path.
function provisionalMeta(file: File): FlightMeta {
  return {
    id: `dropped:${file.name}`,
    file: file.name,
    version: 0,
    encrypted: false,
    hasKeychain: false,
    aircraftName: 'DROPPED LOG',
    aircraftSn: file.name,
    startTime: new Date(file.lastModified).toISOString(),
    durationS: 0,
    distanceKm: 0,
    maxHeightM: 0,
    maxSpeedMs: 0,
    recordCount: 0,
    home: { lon: 0, lat: 0 },
  }
}

export function useFlightLoader() {
  const store = useTelemetryStore

  // Actions via getState(), not destructured -- see the conventions section.
  // Destructuring a method off the store's typed interface trips
  // @typescript-eslint/unbound-method even though every action here is an
  // arrow function that never touches `this`.
  const openFlight = useCallback(
    async (meta: FlightMeta) => {
      store.getState().select(meta.id)

      const cached = await getCachedPath(meta.id)
      if (cached) return store.getState().setPath(cached)

      // An encrypted log with no baked keychain is a legitimate resting
      // state, not a failure: FramePanel renders the summary and FRAMES
      // LOCKED from metadata alone.
      if (meta.encrypted && !meta.hasKeychain) {
        store.getState().setLoading(false)
        return
      }

      store.getState().setLoading(true)
      try {
        const bytes = await fetchBytes(`${BASE}flights/${meta.file}`)
        const keychains = meta.encrypted
          ? await fetchKeychains(`${BASE}flights/${meta.id}.keychain.json`)
          : null
        const path = await decodeFlight(bytes, keychains, meta)
        store.getState().setPath(path)
        void putCachedPath(path)
      } catch (err) {
        store.getState().setError(err instanceof Error ? err.message : 'could not open flight')
      }
    },
    [store],
  )

  const openDroppedFile = useCallback(
    async (file: File) => {
      const meta = provisionalMeta(file)
      store.getState().addSessionFlight(meta)
      store.getState().select(meta.id)
      store.getState().setLoading(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // A dropped log carries no keychain. Pre-v13 logs decode anyway;
        // v13+ ones fail here and surface as an error, which is the honest
        // outcome given DJI's endpoint cannot be reached from the browser.
        const path = await decodeFlight(bytes, null, meta)
        store.getState().setPath(path)
        void putCachedPath(path)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        store.getState().setError(`Could not read ${file.name}: ${reason}`)
      }
    },
    [store],
  )

  return { openFlight, openDroppedFile }
}
