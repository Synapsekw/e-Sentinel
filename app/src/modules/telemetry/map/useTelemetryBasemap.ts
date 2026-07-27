// Telemetry's half of the basemap control (spec section 8.1). Same shape as
// planner/map/usePlannerBasemap.ts -- apply once when the map is ready, then
// again whenever the relevant store fields change -- and applies the SAME
// shared appliers from console/map/basemap.ts rather than a private copy of
// them. "What does basemap X mean" is one fact; duplicating it here is the
// exact shape of this project's two worst shipped bugs.
//
// Written as its own hook, not by importing usePlannerBasemap: that hook's
// behaviour (not just its style) is planner-specific, and whether telemetry
// needed the same shape was unverified until checked here. It does: telemetry
// builds its style on buildBaseStyle() (map/telemetryStyle.ts), the exact
// same cartography-only base the planner uses, so this hook re-derives the
// planner's two deliberate choices independently rather than assuming them.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '@/shared/store'
import { applyRasterVisibility, applyPlaceLabelTheme } from '@/modules/console/map/basemap'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'

function applyTelemetryBasemap(map: maplibregl.Map): void {
  const { layer, offline } = useAppStore.getState()
  // DELIBERATE DIVERGENCE from the console's useBasemap, which computes
  // `eff = offline ? null : effectiveLayer(scene, layer)`. Telemetry has no
  // globe scene -- MapView is mounted here with manageBasemap={false}, and
  // the app-level `scene` field only ever means the console's orbital-vs-
  // theater view -- so consulting it would let a leftover console 'globe'
  // scene force satellite imagery on this module for no telemetry reason.
  // Reads `layer` directly, same as the planner's usePlannerBasemap.
  const eff: string | null = offline ? null : layer
  // Not cosmetic: shared/tokens.css keys --chrome off :root[data-maplayer=...]
  // and telemetry.css uses var(--chrome) for the topbar, library, frame panel
  // and scrubber. Without this stamp telemetry's glass is themed by whatever
  // module last wrote the attribute. Stamps the SELECTED layer, same as the
  // console and planner do.
  document.documentElement.dataset.maplayer = layer
  applyRasterVisibility(map, eff)
  applyPlaceLabelTheme(map, eff)
  // No setOperationalLayersVisible here, for the same reason as the planner:
  // OPERATIONAL_LAYER_IDS mixes console simulation layers (docks/drones/
  // missions/tracks/wizard) that buildTelemetryStyle never adds (it builds on
  // buildBaseStyle(), like the planner's plannerStyle.ts, not the console's
  // buildStyle()) with UAE cartography (`uae-places`, `uae-roads`) that
  // buildBaseStyle DOES include and that must stay visible here. Telemetry's
  // own flight-path layers (tm-path-full, tm-path-traversed, tm-home,
  // tm-position, from map/telemetryStyle.ts) aren't in that list either, so
  // this hook never touches them -- useFlightLayers owns their data, this
  // hook only owns the basemap underneath.
}

// Applies the app-level basemap selection to telemetry's map: once when the
// map becomes ready, and again whenever `layer` or `offline` change. The
// subscription is narrowed to those two fields -- notably NOT `scene` -- so
// console-only store writes never re-apply telemetry's basemap.
export function useTelemetryBasemap(
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
    // console/map/mapLifecycle.ts). The precedent is usePlannerBasemap.ts.
    const apply = () => {
      if (!isMapUsable(mapRef.current)) return
      applyTelemetryBasemap(mapRef.current)
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
