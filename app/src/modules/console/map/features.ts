// Ported (Phase 1B / Task 2) verbatim from assets/js/ui/map.js:53-93
// (EC2.dockFeatures / EC2.siteFeatures / EC2.coverageFeatures). Only the
// module wiring and typing changed: the legacy coverageFeatures read
// `window.DOCK_RANGE` / `window.SimRouter` defensively (they were globals
// attached by separately-loaded scripts) and returned an empty
// FeatureCollection if either was missing; here DOCK_RANGE and SimRouter
// are real static imports from the domain barrel, always present, so that
// guard is dropped as dead code — the feature shapes and math are
// otherwise identical.

import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { DATA_DOCKS, DATA_SITES, DOCK_RANGE, SimRouter } from '@/modules/console/domain'
import type { DockSeed, Site } from '@/modules/console/domain'

export function dockFeatures(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: DATA_DOCKS.map((d): Feature<Point> => ({
      type: 'Feature',
      properties: {
        id: d.id,
        name: d.name,
        emirate: d.emirate,
        model: d.model,
        state: 'ready',
        selected: false,
      },
      geometry: { type: 'Point', coordinates: d.coords },
    })),
  }
}

export function siteFeatures(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: DATA_SITES.map((s): Feature<Point> => ({
      type: 'Feature',
      properties: { id: s.id, name: s.name, status: s.status },
      geometry: { type: 'Point', coordinates: s.coords },
    })),
  }
}

// Coverage rings for every ground location — drone docks AND live tower
// sites — at their operational radius (urban 3 km / rural 5 km, from
// DOCK_RANGE). Real-geography circle polygons (not pixel-radius circles) so
// a ring stays a true 3/5 km on the ground at every zoom; SimRouter.orbit
// returns a closed [lon,lat] ring at a metric radius, wrapped as a Polygon.
// `active` marks live coverage (all docks, plus sites with status
// 'installed'); planned / needs-replacement sites ride along with
// active:false so the layers can render them as a fainter outline-only ring.
function ringFor(item: DockSeed | Site, kind: 'dock' | 'site', active: boolean): Feature<Polygon> {
  const rangeKm = DOCK_RANGE.dockRangeKm(item)
  return {
    type: 'Feature',
    properties: { id: item.id, kind, rangeKm, urban: DOCK_RANGE.isUrbanDock(item), active },
    geometry: { type: 'Polygon', coordinates: [SimRouter.orbit(item.coords, rangeKm * 1000, 64)] },
  }
}

export function coverageFeatures(): FeatureCollection<Polygon> {
  const feats: Feature<Polygon>[] = []
  for (const d of DATA_DOCKS) feats.push(ringFor(d, 'dock', true))
  for (const s of DATA_SITES) feats.push(ringFor(s, 'site', s.status === 'installed'))
  return { type: 'FeatureCollection', features: feats }
}
