// Ported (Phase 1B / Task 3) from assets/js/ui/map.js:120-126
// (setOperationalLayersVisible), :888-892 (the load-handler's scene
// subscriptions wiring scene changes to setOperationalLayersVisible /
// applyBasemap, plus the initial apply-once-on-boot calls), and :973-993
// (applyBasemap / applyPlaceLabelTheme). Only the module wiring changed:
// legacy EC2.onSceneChange callbacks are replaced by a single Zustand
// subscription reacting to scene/layer/offline together, and "apply once on
// boot" becomes "apply once when the map becomes ready".

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '@/shared/store'
import { effectiveLayer, DARK_OVERLAY_IDS, OPERATIONAL_LAYER_IDS } from './basemap'

function setOperationalLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none'
  for (const id of OPERATIONAL_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }
}

// With _nolabels basemaps, uae-places is the map's only naming layer: retint
// its text/halo per basemap so it reads everywhere. Light + terrain rasters
// are pale (dark ink, light halo); dark + sat + offline stay light-on-dark.
function applyPlaceLabelTheme(map: maplibregl.Map, eff: string | null): void {
  if (!map.getLayer('uae-places')) return
  const pale = eff === 'light' || eff === 'terrain'
  map.setPaintProperty('uae-places', 'text-color', pale ? '#3a404c' : '#aeb6c4')
  map.setPaintProperty('uae-places', 'text-halo-color', pale ? 'rgba(255,255,255,.85)' : '#0a0b0e')
}

function applyBasemap(map: maplibregl.Map): void {
  const { scene, layer, offline } = useAppStore.getState()
  const eff: string | null = offline ? null : effectiveLayer(scene, layer)
  for (const k of ['dark', 'light', 'sat', 'terrain'] as const) {
    map.setLayoutProperty(`raster-${k}`, 'visibility', k === eff ? 'visible' : 'none')
  }
  const overlayVis = eff === 'dark' ? 'visible' : 'none'
  for (const id of DARK_OVERLAY_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', overlayVis)
  }
  applyPlaceLabelTheme(map, eff)
}

// Applies the current scene/layer/offline selection to the map's basemap
// rasters, dark-basemap overlays, place-label theme, and operational-layer
// visibility — once when the map becomes ready, and again whenever scene,
// layer, or offline change (mirrors legacy's onSceneChange + layer-chip
// click handlers, all funneled through one subscription here). The
// subscription is narrowed to those three fields so unrelated store writes
// (e.g. future phases' fields) don't needlessly re-apply the basemap.
export function useBasemap(mapRef: MutableRefObject<maplibregl.Map | null>, ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      applyBasemap(map)
      setOperationalLayersVisible(map, useAppStore.getState().scene === 'console')
    }

    apply()

    let prev = useAppStore.getState()
    const unsubscribe = useAppStore.subscribe((state) => {
      if (
        state.scene !== prev.scene ||
        state.layer !== prev.layer ||
        state.offline !== prev.offline
      ) {
        prev = state
        apply()
      }
    })
    return unsubscribe
  }, [mapRef, ready])
}
