// Ported (Phase 1E / Task 7) from assets/js/ui/panels.js:1468-1473
// (TRACK_STATUS_CHIP), :1480-1489 (activeTrackCount), :1490-1501
// (trackAgeStr / trackExpiryS) and assets/css/console.css:599 (the <60s
// amber expiry threshold, TRACK_EXPIRY_AMBER_S below).
//
// Pure (engine passed in, never read off a `window.__engine` global) so
// this is unit-testable without a React tree or a live engine singleton,
// matching chrome/requestModel.ts's reqAgeStr/reqProgress pattern.
//
// NOTE on activeTrackCount: panels/opsDigest.ts (Phase 1D / Task 7) already
// ports the very same panels.js:1480-1489 function for the ops digest's
// stats line. Task 7's brief asks trackModel.ts to also export it (the
// track review panel is its own file, deliberately decoupled from the ops
// digest module), so this is a small intentional duplication rather than a
// missed reuse -- opsDigest.ts is outside this task's file scope.

import type { Engine, Track, TrackStatus } from '@/modules/console/domain'
import { fmtETA } from '@/modules/console/chrome/format'

export interface TrackStatusChip {
  cls: string
  text: string
}

// panels.js:1468-1473.
export const TRACK_STATUS_CHIP: Record<TrackStatus, TrackStatusChip> = {
  active: { cls: 'amber', text: 'ACTIVE' },
  tasked: { cls: 'steel', text: 'TASKED' },
  resolved: { cls: '', text: 'RESOLVED' },
  expired: { cls: 'dim', text: 'EXPIRED' },
}

// console.css:599: the expiry countdown ("EXPIRES IN ...") switches to
// amber once fewer than this many seconds remain.
export const TRACK_EXPIRY_AMBER_S = 60

// panels.js:1480-1489.
export function activeTrackCount(engine: Engine | null): number {
  if (!engine || !engine.tracks) return 0
  let n = 0
  for (const t of engine.tracks.values()) {
    if (t.status === 'active') n++
  }
  return n
}

// Track age as 'T+M:SS' of sim time since detection. panels.js:1490-1495.
export function trackAgeStr(engine: Engine | null, track: Track): string {
  const now = engine ? engine.now : 0
  return 'T+' + fmtETA(Math.max(0, now - (track.detectedAt || 0)))
}

// panels.js:1497-1501.
export function trackExpiryS(engine: Engine | null, track: Track): number {
  const now = engine ? engine.now : 0
  return Math.max(0, (track.expiresAt || 0) - now)
}
