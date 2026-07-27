// Telemetry map style and its feature builders. Same shape as
// planner/map/plannerStyle.ts: buildBaseStyle() plus this module's sources
// and layers, with the feature builders kept pure so they test without a map.

import type { StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, LineString, Point } from 'geojson'
import { buildBaseStyle } from '@/modules/console/map/style'
import { allCoords, traversedCoords } from '../domain/flightPath'
import type { FlightMeta, FlightPath, FlightSample } from '../domain/types'

export const TELEMETRY_SOURCES = {
  path: 'tm-path',
  traversed: 'tm-traversed',
  home: 'tm-home',
  position: 'tm-position',
} as const

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

function lineCollection(coords: [number, number][]): FeatureCollection<LineString> {
  // MapLibre's GeoJSON tiler drops a LineString with fewer than two
  // positions, so emitting one paints nothing while still costing a tile
  // rebuild. Emit no feature instead.
  if (coords.length < 2) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
    ],
  }
}

export function pathFeature(path: FlightPath | null): FeatureCollection<LineString> {
  return path ? lineCollection(allCoords(path)) : { type: 'FeatureCollection', features: [] }
}

export function traversedFeature(
  path: FlightPath | null,
  t: number,
): FeatureCollection<LineString> {
  return path
    ? lineCollection(traversedCoords(path, t))
    : { type: 'FeatureCollection', features: [] }
}

export function homeFeature(meta: FlightMeta | null): FeatureCollection<Point> {
  if (!meta) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [meta.home.lon, meta.home.lat] },
      },
    ],
  }
}

export function positionFeature(sample: FlightSample | null): FeatureCollection<Point> {
  if (!sample) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { heading: sample.heading },
        geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] },
      },
    ],
  }
}

export function buildTelemetryStyle(): StyleSpecification {
  const base = buildBaseStyle()
  return {
    ...base,
    sources: {
      ...base.sources,
      [TELEMETRY_SOURCES.path]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.traversed]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.home]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.position]: { type: 'geojson', data: empty() },
    },
    layers: [
      ...base.layers,
      // The whole flight, drawn dim. These logs are survey grids -- 22km of
      // path inside a 790x710m box (spec section 3.5) -- so at fit-to-bounds
      // zoom the lawnmower legs sit close together. A thin, low-opacity line
      // keeps the shape readable instead of collapsing it into a solid block.
      {
        id: 'tm-path-full',
        type: 'line',
        source: TELEMETRY_SOURCES.path,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#7d8da3', 'line-width': 1.2, 'line-opacity': 0.45 },
      },
      // Flown so far, bright. At this path density the traversed/untraversed
      // contrast is what actually communicates progress; line width alone
      // cannot, since the legs are only metres apart on screen.
      {
        id: 'tm-path-traversed',
        type: 'line',
        source: TELEMETRY_SOURCES.traversed,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e8eef7', 'line-width': 2, 'line-opacity': 0.95 },
      },
      {
        id: 'tm-home',
        type: 'circle',
        source: TELEMETRY_SOURCES.home,
        paint: {
          'circle-radius': 5,
          'circle-color': '#141D2D',
          'circle-stroke-color': '#e8eef7',
          'circle-stroke-width': 2,
        },
      },
      // Reuses the console's drone icon, seeded into the map by MapView's
      // load handler, so the aircraft reads the same across modules.
      {
        id: 'tm-position',
        type: 'symbol',
        source: TELEMETRY_SOURCES.position,
        layout: {
          'icon-image': 'drone',
          'icon-size': 0.9,
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
      },
    ],
  }
}
