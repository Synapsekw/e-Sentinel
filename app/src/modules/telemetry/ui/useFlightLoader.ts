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
        const result = await decodeFlight(bytes, keychains, meta)
        if (!result.path) {
          // Parsed, but the frames are locked. Keep the metadata on screen.
          store.getState().setLoading(false)
          return
        }
        store.getState().setPath(result.path)
        void putCachedPath(result.path)
      } catch (err) {
        store.getState().setError(err instanceof Error ? err.message : 'Could not open flight.')
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
        // A dropped log carries no keychain, so a v13+ one cannot have its
        // frames decrypted here -- DJI's endpoint has no CORS. But its details
        // block is NOT encrypted, so the decode still returns real metadata and
        // the panel shows the summary over FRAMES LOCKED. That is spec section
        // 9's contract, and it is why this is not an error path.
        const result = await decodeFlight(bytes, null, meta)
        // Replace the guessed placeholder with what the log says about itself.
        // The id stays the loader's own `dropped:<filename>` rather than
        // anything from the log: it is how the session list dedupes, so
        // letting the decoder choose it would risk a duplicate row.
        const resolved = { ...result.meta, id: meta.id }
        store.getState().addSessionFlight(resolved)
        store.getState().select(resolved.id)
        if (!result.path) {
          store.getState().setLoading(false)
          return
        }
        store.getState().setPath(result.path)
        void putCachedPath(result.path)
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Could not read this file.'
        store.getState().setError(`${file.name}: ${reason}`)
      }
    },
    [store],
  )

  return { openFlight, openDroppedFile }
}
