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

// A single flight cannot span more than a day. Anything further than this
// from the log's median timestamp is a corrupt clock, not a long flight.
const MAX_FLIGHT_MS = 24 * 60 * 60 * 1000

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function mode(state: RawFrame['osd']['flycState']): string {
  return typeof state === 'string' ? state : 'UNKNOWN'
}

export function normalizeFrames(frames: RawFrame[], meta: FlightMeta): FlightPath {
  const samples: FlightSample[] = []

  // Pass 1: keep frames that have a parseable clock and a real GPS fix.
  const usable: { f: RawFrame; ms: number }[] = []
  for (const f of frames) {
    const ms = Date.parse(f.custom?.dateTime ?? '')
    if (!Number.isFinite(ms)) continue

    const lat = num(f.osd?.latitude)
    const lon = num(f.osd?.longitude)
    // A 0,0 fix is "no GPS yet", not the Gulf of Guinea. Plotting these
    // stretches the flight path across half the planet.
    if (lat === 0 && lon === 0) continue

    usable.push({ f, ms })
  }
  if (usable.length === 0) return { meta, samples: [] }

  // Pass 2: drop frames with a CORRUPT clock.
  //
  // Real logs carry them. The 5,049-frame m400-2026-02-17-0846 log has two:
  // one stamped 2095-04-15 and one stamped 2012-05-04, among frames that are
  // otherwise all 2026-02-17. They are valid dates, so the Number.isFinite
  // guard above passes them straight through.
  //
  // Leaving them in breaks two things downstream, neither obviously:
  //   - traversedCoords() stops at the first sample past the cursor, so one
  //     far-future frame freezes the drawn path partway through the flight
  //     and it never completes.
  //   - sampleAt()'s binary search assumes t is sorted, and silently returns
  //     the wrong sample once it is not.
  //
  // Anchor on the MEDIAN timestamp, not the first: a corrupt FIRST frame
  // would otherwise poison the anchor and reject the entire rest of the log.
  // A couple of outliers cannot move a median.
  const median = [...usable].sort((a, b) => a.ms - b.ms)[usable.length >> 1].ms
  const sane = usable.filter((u) => Math.abs(u.ms - median) <= MAX_FLIGHT_MS)
  if (sane.length === 0) return { meta, samples: [] }

  // t is relative to the earliest SURVIVING frame, so t=0 is the start of the
  // flight as flown, which is the scrubber's contract.
  const t0 = Math.min(...sane.map((u) => u.ms))
  let lastT = -Infinity

  for (const { f, ms } of sane) {
    const t = (ms - t0) / 1000
    // Belt and braces: anything still out of order after the median filter is
    // dropped, so the array handed to sampleAt() is guaranteed sorted.
    if (t < lastT) continue
    lastT = t

    const lat = num(f.osd?.latitude)
    const lon = num(f.osd?.longitude)
    const xs = num(f.osd?.xSpeed)
    const ys = num(f.osd?.ySpeed)

    samples.push({
      t,
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
