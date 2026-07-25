import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { PLANNER_SOURCES, aoiFeatures, dockFeatures, ringFeatures } from './plannerStyle'
import type { CoverageResult, DeploymentPlan } from '../domain/types'

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
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, PLANNER_SOURCES.aoi, aoiFeatures(plan))
    setData(map, PLANNER_SOURCES.docks, dockFeatures(plan))
    setData(map, PLANNER_SOURCES.rings, ringFeatures(plan))
    // `plan` alone is the correct dependency: every mutation returns a new
    // object, so plan.rev would be a redundant second key on the same change.
  }, [mapRef, ready, plan])

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
}
