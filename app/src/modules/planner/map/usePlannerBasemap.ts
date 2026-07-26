// The planner's half of the basemap control (spec section 4). Mirrors the
// console's useBasemap structure -- apply once when the map is ready, then
// again whenever the relevant store fields change -- but applies the SHARED
// appliers from console/map/basemap.ts rather than its own copy of them.
// "What does basemap X mean" is one fact; duplicating it here is the exact
// shape of this project's two worst shipped bugs.
//
// Before this hook existed, nothing in the planner ever set raster
// visibility, so /planner rendered whatever its style happened to declare and
// its glass chrome was themed by whatever the console last left on <html>.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '@/shared/store'
import { applyRasterVisibility, applyPlaceLabelTheme } from '@/modules/console/map/basemap'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'

function applyPlannerBasemap(map: maplibregl.Map): void {
  const { layer, offline } = useAppStore.getState()
  // DELIBERATE DIVERGENCE from the console's useBasemap, which computes
  // `eff = offline ? null : effectiveLayer(scene, layer)`. The planner reads
  // `layer` directly and MUST NOT consult `scene`: effectiveLayer forces
  // 'sat' while the console's orbital globe scene is up, and the store's
  // default scene is 'globe', so a user who lands on /planner first would get
  // satellite imagery no matter which layer they picked. The planner has no
  // globe and no scene of its own. Both hooks carry this comment so a future
  // reader sees the difference is intended and does not "unify" them.
  const eff: string | null = offline ? null : layer
  // Not cosmetic: shared/tokens.css keys --chrome off :root[data-maplayer=...]
  // and planner.css uses var(--chrome) for the topbar, panels and summary
  // strip. Without this stamp the planner's glass is themed by whatever the
  // console last wrote -- dark chrome over a light basemap, a real legibility
  // failure. Stamps the SELECTED layer, same as the console does.
  document.documentElement.dataset.maplayer = layer
  applyRasterVisibility(map, eff)
  applyPlaceLabelTheme(map, eff)
  // No setOperationalLayersVisible here: OPERATIONAL_LAYER_IDS are the
  // console's simulation layers (docks/drones/missions/tracks/wizard), none of
  // which the planner's style (buildBaseStyle, not buildStyle) contains.
}

// Applies the app-level basemap selection to the planner's map: once when the
// map becomes ready, and again whenever `layer` or `offline` change. The
// subscription is narrowed to those two fields -- notably NOT `scene` -- so
// console-only store writes never re-apply the planner's basemap.
export function usePlannerBasemap(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
): void {
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!isMapUsable(map)) return

    // isMapUsable on every apply, not just at mount: a store write could in
    // principle land between <MapView>'s map.remove() and this effect's
    // cleanup, since React tears a deleted tree down parent-first (see
    // console/map/mapLifecycle.ts). The precedent is useWizard.ts /
    // useManualControl.ts.
    const apply = () => {
      if (!isMapUsable(mapRef.current)) return
      applyPlannerBasemap(mapRef.current)
    }

    apply()

    let prev = useAppStore.getState()
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.layer !== prev.layer || state.offline !== prev.offline) {
        prev = state
        apply()
      }
    })
    return unsubscribe
  }, [mapRef, ready])
}
