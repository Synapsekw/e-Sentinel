// The flight-path -> map bridge. Panels re-render through React; the map is
// fed imperatively so a cursor tick never rebuilds a MapLibre layer.
//
// Split into two effects on purpose, the same reasoning
// planner/map/usePlannerLayers.ts records: the full path is up to 27,000
// coordinates, and folding it into the cursor effect would re-tile the entire
// line on every animation frame.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { sampleAt } from '../domain/flightPath'
import type { FlightPath } from '../domain/types'
import {
  TELEMETRY_SOURCES,
  homeFeature,
  pathFeature,
  positionFeature,
  traversedFeature,
} from './telemetryStyle'

function setData(map: maplibregl.Map, id: string, data: FeatureCollection): void {
  const src = map.getSource<GeoJSONSource>(id)
  if (src) src.setData(data)
}

export function useFlightLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  path: FlightPath | null,
  cursorT: number,
): void {
  // Static geometry: rebuilt only when the flight itself changes.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, TELEMETRY_SOURCES.path, pathFeature(path))
    setData(map, TELEMETRY_SOURCES.home, homeFeature(path?.meta ?? null))
  }, [mapRef, ready, path])

  // Cursor-following geometry. Cheap by comparison: the traversed line is a
  // slice, and the position marker is one point.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, TELEMETRY_SOURCES.traversed, traversedFeature(path, cursorT))
    setData(map, TELEMETRY_SOURCES.position, positionFeature(path ? sampleAt(path, cursorT) : null))
  }, [mapRef, ready, path, cursorT])
}
