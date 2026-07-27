// Turning a DJI log's own details block into FlightMeta, and turning the
// parser's raw errors into something a person can act on.
//
// Both live here rather than in djiLog.worker.ts so they are unit-testable:
// the worker cannot be, and these are exactly the parts that can be wrong.
// Deliberately does not import dji-log-parser-js -- RawDetails is a
// structural subset, the same arrangement normalizeFrames.ts uses.

import type { FlightMeta } from '../domain/types'

export interface RawDetails {
  aircraftName?: string
  aircraftSn?: string
  startTime?: string
  totalTime?: number
  totalDistance?: number
  maxHeight?: number
  maxHorizontalSpeed?: number
  recordLineCount?: number
  longitude?: number
  latitude?: number
}

export type DecodeErrorKind = 'not-dji' | 'needs-keychain' | 'unknown'

// The parser reports failures as Rust backtraces, e.g.
//   "Parse error: no variants matched at 0x0: Info: bad magic at 0x0: 102"
//   "Keychain is required"
// Surfacing those verbatim tells a user nothing they can act on, so they are
// classified here and given real sentences at the call site.
export function classifyDecodeError(err: unknown): DecodeErrorKind {
  const text = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (text.includes('keychain')) return 'needs-keychain'
  // "bad magic" / "no variants matched" mean the header is not a DJI TXT one.
  // "failed to fill whole buffer" means the file was too short to even hold a
  // header, which for our purposes is the same conclusion.
  if (
    text.includes('bad magic') ||
    text.includes('no variants matched') ||
    text.includes('fill whole buffer')
  ) {
    return 'not-dji'
  }
  return 'unknown'
}

export const DECODE_ERROR_MESSAGE: Record<DecodeErrorKind, string> = {
  'not-dji': 'Not a DJI flight record. Expected a DJI TXT flight log.',
  'needs-keychain':
    'This log is encrypted and has no keychain. Add it to app/public/flights/ and run tools/bake-flights.mjs.',
  unknown: 'Could not read this flight log.',
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}

// Builds the real FlightMeta from what the log says about itself, keeping the
// caller's id and filename. A dropped file arrives with a guessed placeholder
// meta; this replaces the guesses with facts, which is why a drop-in shows its
// actual aircraft and duration rather than "DROPPED LOG".
export function metaFromDetails(
  base: FlightMeta,
  version: number,
  details: RawDetails | null | undefined,
): FlightMeta {
  const d = details ?? {}
  const start = str(d.startTime, base.startTime)
  return {
    ...base,
    version,
    encrypted: version >= 13,
    aircraftName: str(d.aircraftName, base.aircraftName),
    aircraftSn: str(d.aircraftSn, base.aircraftSn),
    startTime: Number.isFinite(Date.parse(start)) ? start : base.startTime,
    durationS: num(d.totalTime, base.durationS),
    // totalDistance is documented as metres but is kilometres; see spec 3.2.
    distanceKm: num(d.totalDistance, base.distanceKm),
    maxHeightM: num(d.maxHeight, base.maxHeightM),
    maxSpeedMs: num(d.maxHorizontalSpeed, base.maxSpeedMs),
    recordCount: num(d.recordLineCount, base.recordCount),
    home: { lon: num(d.longitude, base.home.lon), lat: num(d.latitude, base.home.lat) },
  }
}
