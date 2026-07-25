// Ported (Phase 1E / Task 2) from assets/js/ui/control.js:22 (emptyFC),
// :38-40 (showBanner's banner copy) and :88-100 (waypointFeatures). Pure —
// no DOM, no globals; engine/activeId are always parameters, matching the
// domain/chrome pure-model convention already established elsewhere in this
// codebase (e.g. panels/dronePanel.ts).

import type { Feature, FeatureCollection, Point } from 'geojson'
import type { Engine } from '@/modules/console/domain'

// control.js:118-121 (startWpPoll's setInterval(refreshWaypoints, 300)) —
// the queue mutates on every engine tick as the drone arrives at waypoints,
// not just on click, so the manual-wpts layer is polled rather than only
// refreshed on click.
export const WP_POLL_MS = 300

// control.js:40's banner copy, verbatim (showBanner).
export function manualBannerText(droneId: string): string {
  return 'MANUAL CONTROL · ' + droneId + ' · CLICK TO FLY · SHIFT+CLICK TO QUEUE'
}

// The waypoint-number property carried by each feature (control.js:96's
// `properties: { n: i + 1 }`), typed explicitly (rather than relying on
// geojson's default `GeoJsonProperties = {[k: string]: any} | null`) so
// consumers reading `feature.properties?.n` get `number | undefined`
// instead of `any`.
export interface WaypointProps {
  n: number
}

// control.js:22, specialized to this file's own feature/property shape (a
// plain `FeatureCollection` return type would not be assignable back to
// `FeatureCollection<Point, WaypointProps>` below).
function emptyFC(): FeatureCollection<Point, WaypointProps> {
  return { type: 'FeatureCollection', features: [] }
}

// control.js:88-100 (waypointFeatures). Legacy read `window.__engine` /
// `control.activeId` off globals; both are parameters here.
export function waypointFeatures(
  engine: Engine | null,
  activeId: string | null,
): FeatureCollection<Point, WaypointProps> {
  if (!engine || !activeId) return emptyFC()
  const drone = engine.drones.get(activeId)
  const queue = (drone && drone._manualQueue) || []
  return {
    type: 'FeatureCollection',
    features: queue.map((p, i): Feature<Point, WaypointProps> => ({
      type: 'Feature',
      properties: { n: i + 1 },
      geometry: { type: 'Point', coordinates: p },
    })),
  }
}
