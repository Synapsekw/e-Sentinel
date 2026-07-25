import type { StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson'
import buffer from '@turf/buffer'
import { feature, featureCollection } from '@turf/helpers'
import { buildBaseStyle } from '@/modules/console/map/style'
import { effectiveRadius } from '../domain/catalog'
import { BUFFER_STEPS } from '../domain/coverage'
import type { DeploymentPlan } from '../domain/types'

export const PLANNER_SOURCES = {
  aoi: 'planner-aoi',
  rings: 'planner-rings',
  docks: 'planner-docks',
  gaps: 'planner-gaps',
} as const

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

export function aoiFeatures(plan: DeploymentPlan): FeatureCollection {
  return featureCollection(
    // turf's featureCollection() wants a single concrete Feature<G> element
    // type; the array literal built from a.geometry's Polygon|MultiPolygon
    // union does not narrow to that on its own, so this recast is type-only.
    plan.aois.map((a) =>
      feature(a.geometry, { id: a.id, name: a.name, valid: a.valid }),
    ) as Feature<Polygon | MultiPolygon>[],
  )
}

export function dockFeatures(plan: DeploymentPlan): FeatureCollection {
  return featureCollection(
    // Same type-only recast as aoiFeatures: featureCollection() needs the
    // concrete Feature<Point> element type spelled out for its generic.
    plan.docks.map((d) =>
      feature(
        { type: 'Point', coordinates: d.position },
        {
          id: d.id,
          name: d.name,
          source: d.source,
        },
      ),
    ) as Feature<Point>[],
  )
}

export function ringFeatures(plan: DeploymentPlan): FeatureCollection {
  const rings = plan.docks
    .map((d) => {
      const { radiusKm } = effectiveRadius(d)
      if (radiusKm <= 0) return null
      const b = buffer(feature({ type: 'Point', coordinates: d.position }), radiusKm, {
        units: 'kilometers',
        steps: BUFFER_STEPS,
      })
      if (!b) return null
      b.properties = { id: d.id }
      return b
    })
    .filter((f): f is Feature<Polygon | MultiPolygon> => f !== null)
  return featureCollection(rings)
}

// Base cartography plus four planner sources. Deliberately built from
// buildBaseStyle, not buildStyle, so no empty simulation layers come along.
export function buildPlannerStyle(): StyleSpecification {
  const base = buildBaseStyle()
  return {
    ...base,
    sources: {
      ...base.sources,
      [PLANNER_SOURCES.aoi]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.rings]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.docks]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.gaps]: { type: 'geojson', data: empty() },
    },
    layers: [
      ...base.layers,
      {
        id: 'planner-rings-fill',
        type: 'fill',
        source: PLANNER_SOURCES.rings,
        paint: { 'fill-color': '#3ddc97', 'fill-opacity': 0.08 },
      },
      {
        id: 'planner-rings-line',
        type: 'line',
        source: PLANNER_SOURCES.rings,
        paint: { 'line-color': '#3ddc97', 'line-width': 1, 'line-opacity': 0.5 },
      },
      {
        id: 'planner-gaps-fill',
        type: 'fill',
        source: PLANNER_SOURCES.gaps,
        // Red is reserved for brand and alerts: an uncovered gap qualifies.
        paint: { 'fill-color': '#ff5a5a', 'fill-opacity': 0.18 },
      },
      {
        id: 'planner-aoi-line',
        type: 'line',
        source: PLANNER_SOURCES.aoi,
        paint: { 'line-color': '#e8ecf3', 'line-width': 1.5, 'line-dasharray': [2, 1] },
      },
      {
        id: 'planner-docks-circle',
        type: 'circle',
        source: PLANNER_SOURCES.docks,
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'source'], 'auto', '#7aa2f7', '#e8ecf3'],
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5,
        },
      },
    ],
  }
}
