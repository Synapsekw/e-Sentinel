// Ported (Phase 1E / Task 7) from assets/js/ui/panels.js:1614-1632
// (wireMapTrackInteractions) and :1503-1512 (focusTrack — the map-diamond
// click here and OpsDigestPanel.tsx's still-live detection row both jump
// through this same shared function).
//
// Mirrors useMapSelection.ts's ready-gated effect-with-cleanup shape.
// Legacy wired this listener once at boot and polled (500ms) for the
// 'tracks-icons' layer to exist, because the map lane could add layers
// after style load and after control.js's own init ran. The React port
// instead re-registers whenever `useMap().ready` flips true: MapView's
// `ready` latch (Phase 1B) only fires once every style layer — including
// 'tracks-icons' — is already on the map, so the poll has no analogue here.

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useMap } from '@/modules/console/map/MapContext'
import { useEngine } from '@/modules/console/engine/EngineContext'
import type { Engine } from '@/modules/console/domain'
import { inCaptureMode, applyPanel } from './selectEntity'

const TRACKS_LAYER = 'tracks-icons'
const FOCUS_ZOOM = 13

function propString(
  properties: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!properties) return undefined
  const v = properties[key]
  return typeof v === 'string' ? v : undefined
}

// panels.js:1505-1512 (focusTrack). Exported so OpsDigestPanel.tsx's
// still-live detection row (panels.js:1840-1852) can reuse the exact same
// camera-move + panel-open jump instead of duplicating it.
export function focusTrack(
  trackId: string,
  engine: Engine | null,
  map: maplibregl.Map | null,
): void {
  const track = engine ? engine.tracks.get(trackId) : null
  if (track && map && Array.isArray(track.pos)) {
    map.flyTo({ center: track.pos, zoom: FOCUS_ZOOM })
  }
  applyPanel({ mode: 'track', id: trackId })
}

export function useMapTrackInteractions(): void {
  const { mapRef, ready } = useMap()
  const { engineRef } = useEngine()

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const onClick = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return // wizard/manual own map clicks exclusively
      const f = e.features && e.features[0]
      const id = propString(f?.properties, 'id')
      if (!id) return
      focusTrack(id, engineRef.current, map)
    }
    // Hover cursor is the map lane's job — click wiring only here
    // (panels.js:1625's comment, transcribed).

    map.on('click', TRACKS_LAYER, onClick)
    return () => {
      map.off('click', TRACKS_LAYER, onClick)
    }
  }, [ready, mapRef, engineRef])
}
