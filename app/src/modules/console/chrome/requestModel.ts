// Ported (Phase 1D / Task 6) from assets/js/ui/panels.js:1146-1267
// (REQ_PRI_CLASS, getRequest, byNewestRequested, REQ_DONE_MAX,
// requestBuckets, requestMission, reqAgeStr, missionTypeLabel, and the data
// half of reqRowHTML/reqProgressHTML/reqDoneHTML -- their markup lands in
// RequestBoard.tsx) and :1313-1342 (renderRequestList's bucket-driven
// section fill / empty-state rule).
//
// Pure (engine passed in, never read off a `window.__engine` global) so this
// is unit-testable without a React tree or a live engine singleton.

import { MISSIONS_CONFIG } from '@/modules/console/domain'
import type { Engine, FlightRequest, Mission, MissionType } from '@/modules/console/domain'
import { fmtETA } from './format'

// panels.js:1146.
export const REQ_PRI_CLASS: Record<string, string> = {
  URGENT: 'urgent',
  PRIORITY: 'priority',
  ROUTINE: 'routine',
}

// panels.js:1156. completed/declined requests share the DELIVERED section,
// capped to the most recent few so the sidebar can't grow unbounded even
// though the engine itself already caps total requests.
export const REQ_DONE_MAX = 6

// Newest-first by request time -- the shared sort for every board section.
// panels.js:1153.
export function byNewestRequested(a: FlightRequest, b: FlightRequest): number {
  return (b.requestedAt || 0) - (a.requestedAt || 0)
}

export interface RequestBuckets {
  pending: FlightRequest[]
  active: FlightRequest[]
  done: FlightRequest[]
}

// The three REQUEST TRACKING BOARD sections in render order. panels.js:1162-1174.
export function requestBuckets(engine: Engine | null): RequestBuckets {
  const buckets: RequestBuckets = { pending: [], active: [], done: [] }
  if (!engine || !engine.requests) return buckets
  for (const r of engine.requests.values()) {
    if (r.status === 'pending') buckets.pending.push(r)
    else if (r.status === 'approved') buckets.active.push(r)
    else buckets.done.push(r) // completed | declined
  }
  buckets.pending.sort(byNewestRequested)
  buckets.active.sort(byNewestRequested)
  buckets.done.sort(byNewestRequested)
  buckets.done = buckets.done.slice(0, REQ_DONE_MAX)
  return buckets
}

// The mission behind an approved/completed request, wherever it still lives:
// engine.missions first, then the MEDIA library list (finished missions may
// be pruned from the engine but survive in sessionMissions). Null when
// neither has it -- callers must treat the row as inert then.
// `sessionMissions` is Phase 1E's MEDIA library list; it defaults to []
// until that phase supplies a real one. panels.js:1180-1186.
export function requestMission(
  engine: Engine | null,
  req: FlightRequest | null,
  sessionMissions: Mission[] = [],
): Mission | null {
  if (!req || !req.missionId) return null
  const live = engine && engine.missions ? engine.missions.get(req.missionId) : null
  if (live) return live
  return sessionMissions.find((m) => m.id === req.missionId) || null
}

// Request age as 'T+M:SS' from sim time (engine.now - requestedAt).
// panels.js:1190-1193.
export function reqAgeStr(engine: Engine | null, req: FlightRequest): string {
  const now = engine ? engine.now : 0
  return 'T+' + fmtETA(Math.max(0, now - (req.requestedAt || 0)))
}

// panels.js:1195-1198.
export function missionTypeLabel(type: MissionType): string {
  const cfg = MISSIONS_CONFIG[type]
  return cfg ? cfg.label : String(type).toUpperCase()
}

export interface ReqProgress {
  active: boolean
  pct: number
  eta: string
}

// IN PROGRESS row's live progress bar + ETA off the linked mission. A missing
// mission with the request still 'approved' means the launch is (briefly) in
// flight or the mission got pruned -- rendered as 'LAUNCHING' with an empty
// bar, patched live once/if the mission shows up. panels.js:1216-1226 (the
// data half of reqProgressHTML) + panels.js:1293-1301 (patchRequestBoard's
// equivalent live-refresh computation).
export function reqProgress(engine: Engine | null, req: FlightRequest): ReqProgress {
  const m = engine && req.missionId ? engine.missions.get(req.missionId) : null
  const active = !!(m && m.state === 'active')
  const pct = active ? Math.round((m.progress || 0) * 100) : 0
  const eta = active ? 'ETA ' + fmtETA((m.durationS || 0) * (1 - (m.progress || 0))) : 'LAUNCHING'
  return { active, pct, eta }
}
