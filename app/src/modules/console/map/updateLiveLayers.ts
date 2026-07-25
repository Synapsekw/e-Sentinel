// Ported (Phase 1C / Task 2) verbatim from assets/js/ui/map.js:353-388
// (coverageHighlightIds / applyCoverageHighlight / EC2.setRangeHighlight)
// and :409-456 (EC2.updateLiveLayers). Only the module wiring changed:
//   - the module-level dirty-check state (`lastActiveMissionsKey`,
//     `lastTracksKey`, `lastCoverageSel`, `rangeHighlightDockId`,
//     `lastEngineRef`) and the `droneTrails` trail store all become closure
//     state inside `createLiveLayerUpdater()`, so a route remount (a fresh
//     `createLiveLayerUpdater()` call) starts clean instead of inheriting a
//     prior mount's cache keys from shared module globals.
//   - `EC2.map` / `EC2.mapLoaded` / `EC2.state.selection` globals become
//     explicit `update(engine, map, selection, followDroneId, ready)`
//     parameters, with `map` and `selection` additionally stashed in the
//     closure (like legacy's `lastEngineRef`) so `setRangeHighlight` —
//     called independently of a frame's `update()` — can still re-apply the
//     coverage filter the same way legacy's `EC2.setRangeHighlight` re-ran
//     off the globals.
//   - `EC2.mapLoaded` itself becomes the caller-supplied `ready` boolean
//     (Phase 1B's `MapContext.ready`, a one-way latch set once on the
//     map's 'load' event — see MapView.tsx) rather than MapLibre's
//     `map.loaded()`. `map.loaded()` is NOT equivalent: it is recomputed
//     continuously and goes false while the style/sources are dirty or
//     tiles are pending — including as a side effect of this module's own
//     `setData`/`setFilter` calls below, and during ordinary pan/zoom/
//     basemap-switch. Gating on it would make live layers silently skip
//     frames after the very first frame renders. `ready` never resets, so
//     it actually mirrors legacy's latch.
//   - `map.getSource(id).setData(...)` uses the `asGeoJSONSource` narrowing
//     pattern established in usePingDriver.ts (Phase 1B) instead of a bare
//     cast, so a non-geojson source id fails loudly rather than silently
//     no-op-ing.
// No logic, constant, cache-key format, or control-flow changes.

import type maplibregl from 'maplibre-gl'
import type { FilterSpecification, GeoJSONSource, Source } from 'maplibre-gl'
import type { Engine } from '@/modules/console/domain'
import type { Selection } from '@/shared/store'
import {
  buildDockFeatures,
  buildDroneFeatures,
  buildLeaderFeatures,
  buildMissionLineFeatures,
  buildTrackFeatures,
  spotlitMissionId,
  TrailStore,
} from './liveFeatures'

// Mirrors usePingDriver.ts's asGeoJSONSource: a `Source` returned by
// `getSource()` doesn't carry `setData` in its public type (only
// `GeoJSONSource` does); narrow with an `in` check rather than a blind cast
// so a non-geojson source id would fail loudly instead of silently no-op-ing.
function asGeoJSONSource(source: Source | undefined): GeoJSONSource | null {
  return source && 'setData' in source ? (source as GeoJSONSource) : null
}

export interface LiveLayerUpdater {
  update(
    engine: Engine,
    map: maplibregl.Map,
    selection: Selection | null,
    followDroneId: string | null,
    ready: boolean,
  ): void
  setRangeHighlight(dockId: string | null): void
}

// Closure factory replacing the module-scoped globals map.js used for the
// same state (see file header). Called once per map mount.
export function createLiveLayerUpdater(): LiveLayerUpdater {
  const trailStore = new TrailStore()
  let lastActiveMissionsKey = ''
  let lastTracksKey = ''
  let lastCoverageSel: string | null = null
  let rangeHighlightDockId: string | null = null
  // Stashed on every update() call (mirrors legacy's lastEngineRef, plus the
  // map/selection legacy read straight off EC2.map / EC2.state.selection)
  // so setRangeHighlight can re-apply the coverage filter outside a frame.
  let lastEngineRef: Engine | null = null
  let lastMapRef: maplibregl.Map | null = null
  let lastSelectionRef: Selection | null = null
  // Stashed from update()'s `ready` parameter (the one-way latch — see file
  // header) so setRangeHighlight's out-of-band call to applyCoverageHighlight
  // can honor the same readiness gate without needing its own `ready` arg.
  let lastReadyRef = false

  // map.js:357-369
  function coverageHighlightIds(engine: Engine | null): string[] {
    const ids: string[] = []
    const sel = lastSelectionRef
    if (sel && sel.type === 'dock') {
      ids.push(sel.id)
    } else if (sel && sel.type === 'drone' && engine) {
      const d = engine.drones.get(sel.id)
      if (d && d.dockId) ids.push(d.dockId)
    }
    if (rangeHighlightDockId && ids.indexOf(rangeHighlightDockId) === -1) {
      ids.push(rangeHighlightDockId)
    }
    return ids
  }

  // map.js:371-380. Coverage is static geometry, so highlighting is done
  // purely with layer filters — never setData — and only re-applied when
  // the id set actually changes (cached by the joined key).
  //
  // Gated on `lastReadyRef` (stashed from update()'s `ready` latch), not
  // `map.loaded()` — see file header. setRangeHighlight() calls this
  // out-of-band (outside a frame's update()), so it relies on whatever
  // readiness update() last observed rather than taking its own `ready` arg.
  function applyCoverageHighlight(engine: Engine | null): void {
    const map = lastMapRef
    if (!map || !lastReadyRef) return
    const ids = coverageHighlightIds(engine)
    const key = ids.join(',')
    if (key === lastCoverageSel) return
    lastCoverageSel = key
    const filter: FilterSpecification = ['in', ['get', 'id'], ['literal', ids]]
    if (map.getLayer('coverage-fill')) map.setFilter('coverage-fill', filter)
    if (map.getLayer('coverage-line-hi')) map.setFilter('coverage-line-hi', filter)
  }

  // map.js:415-456. Called once per rAF/tick frame — keeps the live sources
  // (docks/drones/missions-active/drone-leaders/drone-trails/tracks) in sync
  // with engine state. Each source gets at most one setData() per frame, and
  // the mission/track/trail sources only when their content actually
  // changed.
  function update(
    engine: Engine,
    map: maplibregl.Map,
    selection: Selection | null,
    followDroneId: string | null,
    ready: boolean,
  ): void {
    if (!map || !ready || !engine) return
    lastEngineRef = engine
    lastMapRef = map
    lastSelectionRef = selection
    lastReadyRef = ready

    const dockSrc = asGeoJSONSource(map.getSource('docks'))
    if (dockSrc) dockSrc.setData(buildDockFeatures(engine, selection))

    const droneSrc = asGeoJSONSource(map.getSource('drones'))
    if (droneSrc) droneSrc.setData(buildDroneFeatures(engine))

    const leaderSrc = asGeoJSONSource(map.getSource('drone-leaders'))
    if (leaderSrc) leaderSrc.setData(buildLeaderFeatures(engine))

    const trailSrc = asGeoJSONSource(map.getSource('drone-trails'))
    if (trailSrc && trailStore.updateTrails(engine))
      trailSrc.setData(trailStore.buildTrailFeatures())

    const missionSrc = asGeoJSONSource(map.getSource('missions-active'))
    if (missionSrc) {
      const spotId = spotlitMissionId(engine, selection, followDroneId)
      // Selection identity is part of the cache key (C-5) so a spotlight
      // change re-renders even when the set of active missions is unchanged.
      let key = (spotId || '') + '|'
      for (const m of engine.missions.values()) if (m.state === 'active') key += m.id + ','
      if (key !== lastActiveMissionsKey) {
        lastActiveMissionsKey = key
        missionSrc.setData(buildMissionLineFeatures(engine, spotId))
      }
    }

    const trackSrc = asGeoJSONSource(map.getSource('tracks'))
    if (trackSrc && engine.tracks) {
      let key = ''
      for (const t of engine.tracks.values()) {
        if (t.status === 'active' || t.status === 'tasked') key += t.id + ':' + t.status + ','
      }
      if (key !== lastTracksKey) {
        lastTracksKey = key
        trackSrc.setData(buildTrackFeatures(engine))
      }
    }

    applyCoverageHighlight(engine)
  }

  // C-4: wizard step 2 / manual mode call this to spotlight one dock's range
  // ring. Safe before map load — the id is stashed and applied on the next
  // update() frame (or immediately when the map is already up). map.js:385-388
  function setRangeHighlight(dockId: string | null): void {
    rangeHighlightDockId = dockId || null
    applyCoverageHighlight(lastEngineRef)
  }

  return { update, setRangeHighlight }
}
