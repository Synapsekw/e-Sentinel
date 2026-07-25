// Ported from assets/js/ui/panels.js: nowClockStr (:118-120), FLYING_STATES/
// ALERT_STATES (:115-116), fmtETA (:152-155), fmtMMSS (:632-637), thousands
// (:639-642), battLevel (:401-403), padHeading (:405-407), DRONE_STATE_LABELS
// (:48-52).
//
// This is the canonical home for `nowClockStr` — it previously lived only in
// hud/tickerModel.ts (Phase 1C), which now re-exports it from here so every
// existing import keeps working with exactly one implementation.

import type { DockState, DroneState } from '@/modules/console/domain'

// panels.js:118-120.
export function nowClockStr(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

// panels.js:115-116.
export const FLYING_STATES: DockState[] = ['launching', 'drone-away', 'landing']
export const ALERT_STATES: DockState[] = ['fault', 'offline']

// ETA as M:SS (single-digit minutes allowed, unlike fmtMMSS's MM:SS).
// panels.js:152-155.
export function fmtETA(totalS: number): string {
  const s = Math.max(0, Math.round(totalS || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// panels.js:632-637.
export function fmtMMSS(totalS: number): string {
  const s = Math.max(0, Math.round(totalS || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0')
}

// panels.js:639-642.
export function thousands(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(v)
}

// panels.js:401-403.
export function battLevel(pct: number): 'ok' | 'amber' | 'red' {
  return pct <= 25 ? 'red' : pct <= 49 ? 'amber' : 'ok'
}

// panels.js:405-407.
export function padHeading(deg: number): string {
  return String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0')
}

// panels.js:48-52.
export const DRONE_STATE_LABELS: Record<DroneState, string> = {
  takeoff: 'TAKEOFF',
  transit: 'TRANSIT',
  'on-task': 'ON TASK',
  rtb: 'RETURN TO DOCK',
  landing: 'LANDING',
  hold: 'HELD',
  docked: 'DOCKED',
  manual: 'MANUAL CONTROL',
}
