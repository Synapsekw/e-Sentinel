// Ported (Phase 1A / Task 4) verbatim from assets/js/sim/router.js.
// Only the module wiring changed (IIFE + global-attach -> ES module
// exports + type annotations); every function body — the equirectangular/
// haversine-style math, orbit's closed-ring construction, perimeter's
// aliasing of orbit, and atob's Math.random() jitter branch — is
// transcribed exactly. Do not "fix" the jitter branch; it is unused by the
// engine but kept byte-faithful to the legacy source.

import type { LonLat } from './types'

const R = 6371000,
  D2R = Math.PI / 180

// Local 2-vector for planar offsets/rotations (dx/dy in meters), not to be
// confused with LonLat (lon/lat degrees) even though both are [number,
// number] tuples.
type Vec2 = [number, number]

function offsetMeters([lon, lat]: LonLat, dxM: number, dyM: number): LonLat {
  return [lon + dxM / (R * Math.cos(lat * D2R)) / D2R, lat + dyM / R / D2R]
}

function distM(a: LonLat, b: LonLat): number {
  const x = (b[0] - a[0]) * D2R * R * Math.cos(((a[1] + b[1]) / 2) * D2R),
    y = (b[1] - a[1]) * D2R * R
  return Math.hypot(x, y)
}

function pathLengthKm(c: LonLat[]): number {
  let s = 0
  for (let i = 1; i < c.length; i++) s += distM(c[i - 1], c[i])
  return s / 1000
}

function bearing(a: LonLat, b: LonLat): number {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * D2R),
    y = b[1] - a[1]
  return (Math.atan2(x, y) / D2R + 360) % 360
}

function rot([x, y]: Vec2, deg: number): Vec2 {
  const r = deg * D2R
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
}

function lawnmower(
  center: LonLat,
  widthKm: number,
  heightKm: number,
  spacingM: number,
  bearingDeg: number,
): LonLat[] {
  const w = widthKm * 1000,
    h = heightKm * 1000,
    out: LonLat[] = []
  const passes = Math.max(2, Math.round(h / spacingM) + 1)
  for (let i = 0; i < passes; i++) {
    const yy = -h / 2 + (passes > 1 ? (i * h) / (passes - 1) : 0)
    const a: Vec2 = [-w / 2, yy],
      b: Vec2 = [w / 2, yy]
    const [p, q] = i % 2 === 0 ? [a, b] : [b, a]
    out.push(
      offsetMeters(center, ...rot(p, bearingDeg)),
      offsetMeters(center, ...rot(q, bearingDeg)),
    )
  }
  return out
}

function orbit(center: LonLat, radiusM: number, points = 24): LonLat[] {
  const out: LonLat[] = []
  for (let i = 0; i < points; i++) {
    const a = (i / points) * 2 * Math.PI
    out.push(offsetMeters(center, Math.cos(a) * radiusM, Math.sin(a) * radiusM))
  }
  out.push(out[0].slice() as LonLat)
  return out
}

function perimeter(center: LonLat, radiusM: number, points = 6): LonLat[] {
  return orbit(center, radiusM, points)
}

function atob(from: LonLat, to: LonLat, viaJitterM = 0): LonLat[] {
  if (!viaJitterM) return [from, to]
  const mid: LonLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  return [
    from,
    offsetMeters(
      mid,
      (Math.random() - 0.5) * 2 * viaJitterM,
      (Math.random() - 0.5) * 2 * viaJitterM,
    ),
    to,
  ]
}

function corridor(polyline: LonLat[], startFrac: number, lengthKm: number): LonLat[] {
  const total = pathLengthKm(polyline),
    want = Math.min(lengthKm, total * (1 - startFrac))
  const startKm = total * startFrac
  let acc = 0
  const out: LonLat[] = []
  for (let i = 1; i < polyline.length; i++) {
    const seg = distM(polyline[i - 1], polyline[i]) / 1000,
      a = acc,
      b = acc + seg
    acc = b
    if (b < startKm) continue
    if (a > startKm + want) break
    const t0 = Math.max(0, (startKm - a) / seg),
      t1 = Math.min(1, (startKm + want - a) / seg)
    const lerp = (t: number): LonLat => [
      polyline[i - 1][0] + (polyline[i][0] - polyline[i - 1][0]) * t,
      polyline[i - 1][1] + (polyline[i][1] - polyline[i - 1][1]) * t,
    ]
    if (out.length === 0) out.push(lerp(t0))
    out.push(lerp(t1))
  }
  return out
}

function pointAlong(coords: LonLat[], frac: number): { pos: LonLat; heading: number } {
  const totalKm = pathLengthKm(coords)
  const want = totalKm * Math.min(Math.max(frac, 0), 1) * 1000
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = distM(coords[i - 1], coords[i])
    if (acc + seg >= want || i === coords.length - 1) {
      const t = seg ? Math.min(1, (want - acc) / seg) : 0
      const pos: LonLat = [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ]
      return { pos, heading: bearing(coords[i - 1], coords[i]) }
    }
    acc += seg
  }
  return { pos: coords[coords.length - 1], heading: 0 }
}

export {
  offsetMeters,
  distM,
  pathLengthKm,
  bearing,
  lawnmower,
  orbit,
  perimeter,
  atob,
  corridor,
  pointAlong,
}

export const SimRouter = {
  offsetMeters,
  distM,
  pathLengthKm,
  bearing,
  lawnmower,
  orbit,
  perimeter,
  atob,
  corridor,
  pointAlong,
} as const
