// The normalization seam (spec section 6). DJI's Frame carries ~100 fields
// and serializes to 65MB for a 27k-record log; this reduces it to the 13
// fields the UI reads, about 2.5MB.
//
// Deliberately does NOT import dji-log-parser-js. RawFrame below is a
// structural subset of the parser's Frame type, which keeps this module (and
// its test) free of WASM and makes the normalization independently testable.

import type { FlightMeta, FlightPath, FlightSample } from '../domain/types'

export interface RawFrame {
  custom: { dateTime: string }
  osd: {
    latitude: number
    longitude: number
    altitude: number
    height: number
    xSpeed: number
    ySpeed: number
    zSpeed: number
    yaw: number
    gpsNum: number
    flycState?: string | { Unknown: number }
  }
  gimbal: { pitch: number }
  battery: { chargeLevel: number; voltage?: number }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function mode(state: RawFrame['osd']['flycState']): string {
  return typeof state === 'string' ? state : 'UNKNOWN'
}

export function normalizeFrames(frames: RawFrame[], meta: FlightMeta): FlightPath {
  const samples: FlightSample[] = []
  let t0: number | null = null

  for (const f of frames) {
    const ms = Date.parse(f.custom?.dateTime ?? '')
    if (!Number.isFinite(ms)) continue

    const lat = num(f.osd?.latitude)
    const lon = num(f.osd?.longitude)
    // A 0,0 fix is "no GPS yet", not the Gulf of Guinea. Plotting these
    // stretches the flight path across half the planet.
    if (lat === 0 && lon === 0) continue

    if (t0 === null) t0 = ms

    const xs = num(f.osd?.xSpeed)
    const ys = num(f.osd?.ySpeed)

    samples.push({
      t: (ms - t0) / 1000,
      lon,
      lat,
      alt: num(f.osd?.altitude),
      height: num(f.osd?.height),
      speedH: Math.hypot(xs, ys),
      speedV: num(f.osd?.zSpeed),
      heading: num(f.osd?.yaw),
      gimbalPitch: num(f.gimbal?.pitch),
      battery: num(f.battery?.chargeLevel),
      voltage: num(f.battery?.voltage),
      sats: num(f.osd?.gpsNum),
      mode: mode(f.osd?.flycState),
    })
  }

  return { meta, samples }
}
