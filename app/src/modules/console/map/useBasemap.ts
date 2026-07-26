// Ported (Phase 1B / Task 3) from assets/js/ui/map.js:120-126
// (setOperationalLayersVisible), :888-892 (the load-handler's scene
// subscriptions wiring scene changes to setOperationalLayersVisible /
// applyBasemap, plus the initial apply-once-on-boot calls), and :973-993
// (applyBasemap / applyPlaceLabelTheme). Only the module wiring changed:
// legacy EC2.onSceneChange callbacks are replaced by a single Zustand
// subscription reacting to scene/layer/offline together, and "apply once on
// boot" becomes "apply once when the map becomes ready".
//
// The raster/overlay and place-label appliers themselves now live in
// basemap.ts (moved verbatim, unchanged) because the planner's LAYERS control
// applies the same rules to its own map; see basemap.ts's header there.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '@/shared/store'
import {
  effectiveLayer,
  applyRasterVisibility,
  applyPlaceLabelTheme,
  OPERATIONAL_LAYER_IDS,
} from './basemap'

function setOperationalLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none'
  for (const id of OPERATIONAL_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }
}

function applyBasemap(map: maplibregl.Map): void {
  const { scene, layer, offline } = useAppStore.getState()
  // DELIBERATE DIVERGENCE from the planner's usePlannerBasemap, which computes
  // `eff = offline ? null : layer` and never consults `scene`. The console has
  // an orbital globe scene, and effectiveLayer forces 'sat' while it is up, so
  // the console MUST go through effectiveLayer. The planner has no globe, and
  // the store's default scene is 'globe', so routing the planner through this
  // same call would hand a user who lands on /planner first satellite imagery
  // no matter what they picked. Both comments exist so a future reader sees
  // the difference is intended and does not "unify" the two hooks.
  const eff: string | null = offline ? null : effectiveLayer(scene, layer)
  // Legacy EC2.setLayer (assets/js/ui/map.js:997) stamps the SELECTED layer
  // (not the effective one) onto the root element so CSS can adapt chrome to
  // the basemap (console.css:18-20 keys --chrome off
  // :root[data-maplayer=...]); mirrored here so the stamp stays correct even
  // while the orbital globe scene is forcing the effective raster to 'sat'.
  document.documentElement.dataset.maplayer = layer
  // applyRasterVisibility / applyPlaceLabelTheme moved verbatim into
  // basemap.ts so the planner applies the identical rules; this call order
  // (rasters + dark overlays, then place labels) is the original one.
  applyRasterVisibility(map, eff)
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
