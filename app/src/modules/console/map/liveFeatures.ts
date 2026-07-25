// Ported (Phase 1C / Task 2) verbatim from assets/js/ui/map.js:189-345: the
// live GeoJSON feature builders (docks/drones/mission lines/tracks/leaders),
// spotlitMissionId, and the breadcrumb-trail machinery. Only the module
// wiring and typing changed:
//   - `EC2.state.selection` / `EC2.followDroneId` globals become explicit
//     parameters (`selection`, `followDroneId`) on the functions that read
//     them.
//   - `window.SimRouter` reads become the real static `SimRouter` import
//     (features.ts already established dropping that defensive guard as
//     dead code once SimRouter is a genuine import rather than a global).
//   - the module-level `droneTrails` Map (map.js:307) becomes instance state
//     inside the `TrailStore` class below, so a route remount (a fresh
//     `new TrailStore()`) starts with no stale trails, instead of a single
//     module-global surviving across mounts.
// No logic, constant, or property-shape changes.

import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Engine } from '@/modules/console/domain'
import { SimRouter } from '@/modules/console/domain'
import type { LonLat } from '@/modules/console/domain'
import type { Selection } from '@/shared/store'

// map.js:189-205
export function buildDockFeatures(
  engine: Engine,
  selection: Selection | null,
): FeatureCollection<Point> {
  const selId = selection && selection.type === 'dock' ? selection.id : null
  const features: Feature<Point>[] = []
  for (const dock of engine.docks.values()) {
    features.push({
      type: 'Feature',
      properties: {
        id: dock.id,
        name: dock.name,
        emirate: dock.emirate,
        model: dock.drone ? dock.drone.model : '',
        state: dock.state,
        selected: dock.id === selId,
      },
      geometry: { type: 'Point', coordinates: dock.coords },
    })
  }
  return { type: 'FeatureCollection', features }
}

// map.js:207-220
export function buildDroneFeatures(engine: Engine): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  for (const drone of engine.drones.values()) {
    if (drone.state === 'docked') continue
    const p = drone.pos
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    features.push({
      type: 'Feature',
      properties: { id: drone.id, heading: drone.heading || 0, state: drone.state },
      geometry: { type: 'Point', coordinates: p },
    })
  }
  return { type: 'FeatureCollection', features }
}

// map.js:222-234
export function buildMissionLineFeatures(
  engine: Engine,
  spotId: string | null,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const mission of engine.missions.values()) {
    if (mission.state !== 'active') continue
    if (!Array.isArray(mission.waypoints) || mission.waypoints.length < 2) continue
    features.push({
      type: 'Feature',
      properties: { id: mission.id, type: mission.type, spotlit: mission.id === spotId },
      geometry: { type: 'LineString', coordinates: mission.waypoints },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Detection tracks: only 'active' and 'tasked' render; resolved/expired
// vanish from the map. map.js:244-257
export function buildTrackFeatures(engine: Engine): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  for (const track of engine.tracks.values()) {
    if (track.status !== 'active' && track.status !== 'tasked') continue
    const p = track.pos
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    features.push({
      type: 'Feature',
      properties: { id: track.id, label: track.label, status: track.status },
      geometry: { type: 'Point', coordinates: p },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Route spotlight (C-5): the one mission the operator is attending to — the
// selected drone's, a selected dock's away-drone's, or the followed drone's
// — renders solid and bright; every other active route drops to a faint
// dashed hairline. map.js:263-278
export function spotlitMissionId(
  engine: Engine,
  selection: Selection | null,
  followDroneId: string | null,
): string | null {
  if (selection && selection.type === 'drone') {
    const d = engine.drones.get(selection.id)
    if (d && d.missionId) return d.missionId
  }
  if (selection && selection.type === 'dock') {
    const dock = engine.docks.get(selection.id)
    if (dock && dock.drone && dock.drone.missionId) return dock.drone.missionId
  }
  if (followDroneId) {
    const d = engine.drones.get(followDroneId)
    if (d && d.missionId) return d.missionId
  }
  return null
}

// Velocity leaders: a thin ~800m line ahead of each moving drone along its
// heading. SimRouter.offsetMeters takes (pos, eastMeters, northMeters);
// heading is degrees clockwise from north, so east = sin, north = cos.
// map.js:284-299
export function buildLeaderFeatures(engine: Engine): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const drone of engine.drones.values()) {
    if (drone.state === 'docked' || !(drone.speedMs > 0)) continue
    const p = drone.pos
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const rad = ((drone.heading || 0) * Math.PI) / 180
    features.push({
      type: 'Feature',
      properties: { id: drone.id },
      geometry: {
        type: 'LineString',
        coordinates: [
          p.slice(),
          SimRouter.offsetMeters(p, Math.sin(rad) * 800, Math.cos(rad) * 800),
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Breadcrumb trails: last ~40 fixes per airborne drone, spaced >=120m so a
// hovering/orbiting drone doesn't spam points. map.js:305-345
export const TRAIL_MAX_POINTS = 40
export const TRAIL_MIN_STEP_M = 120

// The module-level `droneTrails` Map (map.js:307) becomes instance state
// here so a route remount starts with a clean slate instead of inheriting a
// prior mount's trails from a shared module global.
export class TrailStore {
  private droneTrails = new Map<string, LonLat[]>()

  // map.js:309-333
  updateTrails(engine: Engine): boolean {
    let dirty = false
    for (const drone of engine.drones.values()) {
      if (drone.state === 'docked') {
        if (this.droneTrails.delete(drone.id)) dirty = true
        continue
      }
      const p = drone.pos
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
      const trail = this.droneTrails.get(drone.id)
      if (!trail) {
        this.droneTrails.set(drone.id, [p.slice() as LonLat])
        dirty = true
      } else if (SimRouter.distM(trail[trail.length - 1], p) >= TRAIL_MIN_STEP_M) {
        trail.push(p.slice() as LonLat)
        if (trail.length > TRAIL_MAX_POINTS) trail.shift()
        dirty = true
      }
    }
    for (const id of Array.from(this.droneTrails.keys())) {
      if (!engine.drones.has(id)) {
        this.droneTrails.delete(id)
        dirty = true
      }
    }
    return dirty
  }

  // map.js:335-345
  buildTrailFeatures(): FeatureCollection<LineString> {
    const features: Feature<LineString>[] = []
    for (const entry of this.droneTrails) {
      if (entry[1].length < 2) continue
      features.push({
        type: 'Feature',
        properties: { id: entry[0] },
        geometry: { type: 'LineString', coordinates: entry[1] },
      })
    }
    return { type: 'FeatureCollection', features }
  }
}
