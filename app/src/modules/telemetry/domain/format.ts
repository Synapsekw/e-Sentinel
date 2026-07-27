// Telemetry-specific display formatting. Anything already in
// console/chrome/format.ts (fmtMMSS, fmtETA, thousands, battLevel) is reused
// from there rather than duplicated here.

import { fmtMMSS } from '@/modules/console/chrome/format'

export function fmtFlightClock(t: number): string {
  return 'T+' + fmtMMSS(Math.max(0, t))
}

export function fmtDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS))
  const m = Math.floor(s / 60)
  return m === 0 ? `${s}s` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}

// Logs are UTC and the flights are not in the viewer's timezone, so a local
// rendering would silently shift every timestamp. Formatted as UTC on purpose.
export function fmtDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

export function fmtKm(km: number): string {
  return `${km.toFixed(1)} km`
}

export function fmtMeters(m: number): string {
  return `${Math.round(m)} m`
}

export function fmtSpeed(ms: number): string {
  return `${ms.toFixed(1)} m/s`
}

// DJI reports yaw signed in -180..180; a compass readout wants 0..359.
//
// DELIBERATELY NOT delegating to console/chrome/format.ts's padHeading, which
// looks like the same function and is not. It rounds AFTER the modulo:
//
//   padHeading(359.6) -> '360'      <- not a compass bearing
//   fmtHeading(359.6) -> '000°'
//
// Anything in [359.5, 360) renders as 360. Rounding BEFORE the modulo, as
// here, folds that back to zero. DJI yaw is fractional, so this range is
// reachable in real data rather than theoretical.
//
// Consolidating the two would mean importing that behaviour. If padHeading is
// ever fixed, this can delegate to it and append the degree glyph.
export function fmtHeading(deg: number): string {
  const norm = ((Math.round(deg) % 360) + 360) % 360
  return `${String(norm).padStart(3, '0')}°`
}

// Gimbal pitch is a SIGNED angle, not a compass bearing, so it must not go
// through fmtHeading. A survey camera looking straight down sits at -90; wrap
// that into 0..359 and it reads "270°", which is meaningless for a pitch and
// was on screen until visual verification caught it. DJI reports gimbal pitch
// roughly in -90..+30.
export function fmtPitch(deg: number): string {
  return `${Math.round(deg)}°`
}
