// Ported (Phase 1B / Task 4) verbatim from assets/js/ui/globe.js:1-14
// (the constants block), :34-39 (shortestLngDelta), :97-106
// (altKmFromZoom/fmtAlt), and :155-168 (rotateStep's arithmetic, extracted
// as the pure `nextGlobeCenter`). Pure numbers only — no DOM, no map
// instance — so this module is unit-testable in isolation; useGlobe.ts
// wires it against the live MapLibre instance.
//
// `altKmFromZoom` takes orbit/theater zoom as parameters (rather than
// reading the module-level ORBIT/THEATER objects directly, as legacy does)
// since the live orbit zoom is recomputed per-viewport by fitOrbitZoom() —
// useGlobe.ts owns that mutable current value and passes it in.
//
// `rotateStep` mutated `EC2.map` directly (via setCenter) and returned a
// bare `settled` boolean; `nextGlobeCenter` instead returns the computed
// next center alongside `settled`, leaving the actual map.setCenter() call
// to the caller (useGlobe.ts's tick loop).

export const ORBIT = { center: [54.6, 24.3] as [number, number], zoom: 1.35 }
export const THEATER = { center: [54.35, 24.5] as [number, number], zoom: 6.6 }
export const BEACON: [number, number] = [54.4, 24.3]
export const DIVE_MS = 2600
export const DIVE_CURVE = 1.6
export const IDLE_RESUME_MS = 2500
export const ROTATE_DEG_PER_SEC = 1.2 // minimum approach speed, keeps the old ambient feel near target
export const APPROACH_GAIN = 0.4 // deg/s of approach speed per degree of remaining offset
export const APPROACH_MAX_DEG_PER_SEC = 9
export const SETTLE_EPS_DEG = 0.05 // within this of the beacon meridian we hard-stop
export const INTRO_LNG_OFFSET = 80 // boot with UAE 80deg east of center so the opening shot rotates it in
export const GLOBE_FIT_FRACTION = 0.8 // globe disc diameter as a fraction of the short viewport side
export const TAG_HIT_PX = 60

export function shortestLngDelta(toLng: number, fromLng: number): number {
  let d = (toLng - fromLng) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

// Log-scale interpolation between the orbital and theater altitudes (12742km
// — Earth's diameter — down to 2km) driven by the current zoom's position
// between the orbit and theater zoom levels.
export function altKmFromZoom(zoom: number, orbitZoom: number, theaterZoom: number): number {
  const z0 = orbitZoom,
    z1 = theaterZoom,
    a0 = 12742,
    a1 = 2
  const t = Math.min(1, Math.max(0, (zoom - z0) / (z1 - z0)))
  const logA0 = Math.log(a0),
    logA1 = Math.log(a1)
  return Math.exp(logA0 + (logA1 - logA0) * t)
}

export function fmtAlt(km: number): string {
  return km >= 100 ? Math.round(km).toString() : km.toFixed(1)
}

export interface GlobeCenter {
  lng: number
  lat: number
}

export interface GlobeCenterStep extends GlobeCenter {
  settled: boolean
}

// One step of the homing rotation: carries the view toward the beacon
// meridian (shortest direction), eases down close to it, and hard-stops on
// arrival so the UAE settles front-and-center instead of drifting past.
// Also relaxes any user-dragged latitude back to the orbit latitude so the
// beacon cannot be left hiding near a pole. When settled, the input center
// is returned unchanged (mirrors rotateStep returning `false` without
// calling setCenter).
export function nextGlobeCenter(
  center: GlobeCenter,
  beacon: readonly [number, number],
  orbitLat: number,
  dt: number,
): GlobeCenterStep {
  const dLng = shortestLngDelta(beacon[0], center.lng)
  const dLat = orbitLat - center.lat
  if (Math.abs(dLng) <= SETTLE_EPS_DEG && Math.abs(dLat) <= SETTLE_EPS_DEG) {
    return { lng: center.lng, lat: center.lat, settled: true }
  }
  const speed = Math.min(
    APPROACH_MAX_DEG_PER_SEC,
    Math.max(ROTATE_DEG_PER_SEC, Math.abs(dLng) * APPROACH_GAIN),
  )
  const stepLng = Math.sign(dLng) * Math.min(Math.abs(dLng), speed * dt)
  const latSpeed = Math.min(
    APPROACH_MAX_DEG_PER_SEC,
    Math.max(ROTATE_DEG_PER_SEC, Math.abs(dLat) * APPROACH_GAIN),
  )
  const stepLat = Math.sign(dLat) * Math.min(Math.abs(dLat), latSpeed * dt)
  return { lng: center.lng + stepLng, lat: center.lat + stepLat, settled: false }
}
