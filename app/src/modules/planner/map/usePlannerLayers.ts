import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { PLANNER_SOURCES, aoiFeatures, dockFeatures, ringFeatures } from './plannerStyle'
import type { CoverageResult, DeploymentPlan } from '../domain/types'
import type { PlannerSelection } from '../store/planStore'

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection): void {
  // This maplibre-gl version's getSource<TSource extends Source> already
  // infers GeoJSONSource from the explicit type argument, so an `as` cast
  // here would be flagged unnecessary by @typescript-eslint. Explicit
  // generic argument instead of the brief's `as GeoJSONSource | undefined`.
  const src = map.getSource<GeoJSONSource>(id)
  if (src) src.setData(data)
}

// The plan -> map bridge. Panels re-render through React; the map is fed
// imperatively so a plan edit never rebuilds a MapLibre layer.
export function usePlannerLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  plan: DeploymentPlan,
  coverage: CoverageResult,
  selection: PlannerSelection,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, PLANNER_SOURCES.aoi, aoiFeatures(plan))
    setData(map, PLANNER_SOURCES.docks, dockFeatures(plan))
    setData(map, PLANNER_SOURCES.rings, ringFeatures(plan))
    // Important 8 (final whole-branch review): this used to depend on
    // `plan` itself, so it rebuilt every dock ring buffer (64 steps each, see
    // domain/coverage.ts's BUFFER_STEPS) on EVERY plan edit, including a
    // plan name/customer keystroke that never touches aois or docks. Keying
    // on plan.aois/plan.docks directly instead means a cosmetic-only edit --
    // which domain/plan.ts's bump() always carries the existing aois/docks
    // array references through unchanged -- does not touch the map at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, ready, plan.aois, plan.docks])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, PLANNER_SOURCES.gaps, {
      type: 'FeatureCollection',
      features: coverage.ok
        ? [{ type: 'Feature', geometry: coverage.uncovered, properties: {} }]
        : [],
    })
  }, [mapRef, ready, coverage])

  // Its OWN effect, keyed on `selection` alone. Folding this into the effect
  // above would make every selection click rebuild all N ring buffers (64
  // steps each) -- the exact cost Important 8 removed by narrowing that
  // effect's dependencies to plan.aois/plan.docks.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    const dockId = selection?.type === 'dock' ? selection.id : ''
    const aoiId = selection?.type === 'aoi' ? selection.id : ''
    // The empty id matches nothing, which is how "no selection" is expressed
    // -- see the layers' initial filters in plannerStyle.ts.
    if (map.getLayer('planner-rings-line-hi')) {
      map.setFilter('planner-rings-line-hi', ['==', ['get', 'id'], dockId])
    }
    if (map.getLayer('planner-aoi-line-hi')) {
      map.setFilter('planner-aoi-line-hi', ['==', ['get', 'id'], aoiId])
    }
  }, [mapRef, ready, selection])
}
