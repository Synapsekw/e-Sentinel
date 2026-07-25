// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:126-149
// (DETECTION_SUFFIXES / isDetectionEvent), :157-186 (DIGEST_MISSIONS_CAP /
// digestActiveMissions / digestStatsLine), :207-215 (lastDetections), :242
// (the source-prefix strip inside detectionRowsHTML — split out here as
// detectionBody so OpsDigest.tsx can render it directly as JSX text) and
// :1480-1489 (activeTrackCount).
//
// Pure (engine is always passed in, never read off a global) so this is
// unit-testable without a React tree or a live engine singleton, matching
// the chrome/dockList.ts and chrome/requestBoard.ts pattern from Tasks 5/6.

import type { Engine, Mission, SimEvent } from '@/modules/console/domain'

// panels.js:130-138. Per-type detection copy from engine.ts's DETECTION_MSGS,
// matched structurally: a detection event is info-level, drone-sourced, and
// its message is exactly '<droneId> <one of these suffixes>'. Kept as
// suffixes (not full-string regexes) so a change to id formats can't
// silently break the filter.
export const DETECTION_SUFFIXES = [
  'FLAGGED VEHICLE ON PATROL SWEEP',
  'THERMAL ANOMALY LOGGED',
  'SCENE ASSESSMENT UPDATED',
  'PAYLOAD STATUS NOMINAL',
  'SURVEY DATA CAPTURED',
  'VEHICLE FLAGGED ON HIGHWAY SWEEP',
  'VEGETATION STRESS ZONE FLAGGED',
]

// panels.js:140-149. The engine's own detection events now self-identify
// (code 'DETECTION', tracks lane); the structural suffix match stays as the
// fallback for events emitted before that lane fires.
export function isDetectionEvent(ev: SimEvent | null | undefined): boolean {
  if (!ev) return false
  if (ev.code === 'DETECTION') return true
  if (ev.level !== 'info' || !/^D-/.test(ev.source || '')) return false
  const msg = String(ev.message || '')
  return DETECTION_SUFFIXES.some((sfx) => msg === ev.source + ' ' + sfx)
}

// panels.js:1480-1489.
export function activeTrackCount(engine: Engine | null): number {
  if (!engine || !engine.tracks) return 0
  let n = 0
  for (const t of engine.tracks.values()) {
    if (t.status === 'active') n++
  }
  return n
}

const DIGEST_MISSIONS_CAP = 8

// panels.js:159-169. Active missions only, newest-launched first, capped so
// a long session can't grow the digest without bound.
export function digestActiveMissions(engine: Engine | null): Mission[] {
  if (!engine) return []
  const out: Mission[] = []
  for (const m of engine.missions.values()) {
    if (m.state === 'active') out.push(m)
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
  return out.slice(0, DIGEST_MISSIONS_CAP)
}

// panels.js:171-186. `engine.tracks` is always present on this port's
// Engine (unlike legacy, where the detection-tracks lane could still be
// mid-rollout and thus absent) — the ternary is kept anyway for a faithful
// transcription of the source line.
export function digestStatsLine(engine: Engine | null): string {
  if (!engine) return '104 DOCK STATIONS ONLINE · ALL 7 EMIRATES'
  let ready = 0
  let alerts = 0
  let airborne = 0
  for (const dock of engine.docks.values()) {
    if (dock.state === 'ready') ready++
    else if (dock.state === 'fault' || dock.state === 'offline') alerts++
  }
  for (const d of engine.drones.values()) {
    if (d.state !== 'docked') airborne++
  }
  const trackPart = engine.tracks ? ' · TRACKS ' + activeTrackCount(engine) : ''
  return 'AIRBORNE ' + airborne + ' · READY ' + ready + trackPart + ' · ALERTS ' + alerts
}

// panels.js:207-215.
export function lastDetections(engine: Engine | null, n: number): SimEvent[] {
  if (!engine || !Array.isArray(engine.events)) return []
  const out: SimEvent[] = []
  for (let i = engine.events.length - 1; i >= 0 && out.length < n; i--) {
    if (isDetectionEvent(engine.events[i])) out.push(engine.events[i])
  }
  return out
}

// panels.js:242 (the body-strip line inside detectionRowsHTML).
export function detectionBody(ev: SimEvent): string {
  const msg = String(ev.message || '')
  return msg.indexOf(ev.source + ' ') === 0 ? msg.slice(ev.source.length + 1) : msg
}
