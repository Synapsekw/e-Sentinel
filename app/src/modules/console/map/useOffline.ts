// Ported (Phase 1B / Task 3) from assets/js/ui/map.js:911-937: raster
// tile-error counting, the world-landmass outline fallback shown while
// offline, and the 15s CARTO recovery probe. Only the module wiring
// changed: legacy EC2.setOffline mutated EC2.state.offline directly and was
// the single entry point (called by both the error handler and the
// recovery probe); here the store's setOffline(bool) action is the single
// source of truth for the flag itself, and this hook reacts to `offline`
// changes (however they happen) to drive the map's error counter, the
// world-outline layers, and the probe — the DOM #offline-chip toggle from
// legacy's setOffline is dropped here since the chip itself is rendered by
// Task 5's console chrome, reading the store's `offline` field directly.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { ErrorEvent as MapLibreErrorEvent } from 'maplibre-gl'
import { useAppStore } from '@/shared/store'

const WORLD_OUTLINE_LAYER_IDS = ['world-land-fill', 'world-land-line']
const TILE_ERROR_THRESHOLD = 6
const RECOVERY_PROBE_INTERVAL_MS = 15000
const RECOVERY_PROBE_URL = 'https://a.basemaps.cartocdn.com/dark_nolabels/3/5/3.png'

// Raster tile-fetch failures attach a `sourceId` to the fired ErrorEvent at
// runtime, but the public maplibre-gl types don't declare it (it rides
// along as extra data mixed onto the event object) — narrow it explicitly
// rather than reaching for `any`.
function rasterSourceId(e: MapLibreErrorEvent): string | undefined {
  const sourceId = (e as unknown as { sourceId?: unknown }).sourceId
  return typeof sourceId === 'string' ? sourceId : undefined
}

export function useOffline(mapRef: MutableRefObject<maplibregl.Map | null>, ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    let tileErrors = 0
    const onError = (e: MapLibreErrorEvent) => {
      const sourceId = rasterSourceId(e)
      if (sourceId && sourceId.startsWith('raster-')) {
        tileErrors += 1
        if (tileErrors >= TILE_ERROR_THRESHOLD && !useAppStore.getState().offline) {
          useAppStore.getState().setOffline(true)
        }
      }
    }
    map.on('error', onError)

    let offlineTimer: ReturnType<typeof setInterval> | null = null

    const stopRecoveryProbe = () => {
      if (offlineTimer) {
        clearInterval(offlineTimer)
        offlineTimer = null
      }
    }

    const startRecoveryProbe = () => {
      stopRecoveryProbe()
      tileErrors = 0
      offlineTimer = setInterval(() => {
        // Capture this episode's timer so a stale probe from a previous
        // offline episode can't clear/turn off a newer one that has since
        // superseded it.
        const myTimer = offlineTimer
        const img = new Image()
        img.onload = () => {
          if (offlineTimer !== myTimer) return
          stopRecoveryProbe()
          useAppStore.getState().setOffline(false)
        }
        img.src = `${RECOVERY_PROBE_URL}?t=${Date.now()}`
      }, RECOVERY_PROBE_INTERVAL_MS)
    }

    const syncOffline = (offline: boolean) => {
      const vis = offline ? 'visible' : 'none'
      for (const id of WORLD_OUTLINE_LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
      }
      if (offline) startRecoveryProbe()
      else stopRecoveryProbe()
    }

    let prevOffline = useAppStore.getState().offline
    syncOffline(prevOffline)

    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.offline !== prevOffline) {
        prevOffline = state.offline
        syncOffline(state.offline)
      }
    })

    return () => {
      map.off('error', onError)
      stopRecoveryProbe()
      unsubscribe()
    }
  }, [mapRef, ready])
}
