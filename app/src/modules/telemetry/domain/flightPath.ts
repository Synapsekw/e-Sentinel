// Pure queries over a decoded FlightPath. No React, no MapLibre, no DJI.
// This is the layer every UI component reads through.

import type { FlightPath, FlightSample } from './types'

// Fields safe to interpolate linearly. Deliberately excludes `heading`
// (circular: 350 -> 10 must not sweep through 180), `mode` (an enum label),
// and `sats` (a count). Those come from the nearest sample instead.
const CONTINUOUS = [
  'lon',
  'lat',
  'alt',
  'height',
  'speedH',
  'speedV',
  'gimbalPitch',
  'battery',
  'voltage',
] as const

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

// Largest index whose t is <= target. Binary search: a 27k-sample path is
// queried on every animation frame during playback.
function floorIndex(samples: FlightSample[], t: number): number {
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (samples[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function sampleAt(path: FlightPath, t: number): FlightSample | null {
  const { samples } = path
  if (samples.length === 0) return null
  if (t <= samples[0].t) return samples[0]
  const last = samples[samples.length - 1]
  if (t >= last.t) return last

  const i = floorIndex(samples, t)
  const a = samples[i]
  const b = samples[i + 1]
  if (!b || b.t === a.t) return a

  const f = (t - a.t) / (b.t - a.t)
  const nearest = f < 0.5 ? a : b
  const out: FlightSample = {
    ...nearest,
    t,
    heading: nearest.heading,
    mode: nearest.mode,
    sats: nearest.sats,
  }
  for (const key of CONTINUOUS) out[key] = lerp(a[key], b[key], f)
  return out
}

export function allCoords(path: FlightPath): [number, number][] {
  return path.samples.map((s) => [s.lon, s.lat])
}

export function traversedCoords(path: FlightPath, t: number): [number, number][] {
  const out: [number, number][] = []
  for (const s of path.samples) {
    if (s.t > t) break
    out.push([s.lon, s.lat])
  }
  return out
}

export function pathBounds(path: FlightPath): [[number, number], [number, number]] | null {
  if (path.samples.length === 0) return null
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity
  for (const s of path.samples) {
    if (s.lon < minLon) minLon = s.lon
    if (s.lon > maxLon) maxLon = s.lon
    if (s.lat < minLat) minLat = s.lat
    if (s.lat > maxLat) maxLat = s.lat
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}

const EARTH_R_M = 6371000

export function distanceFromHomeM(
  sample: FlightSample,
  home: { lon: number; lat: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(sample.lat - home.lat)
  const dLon = toRad(sample.lon - home.lon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(home.lat)) * Math.cos(toRad(sample.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(a)))
}
