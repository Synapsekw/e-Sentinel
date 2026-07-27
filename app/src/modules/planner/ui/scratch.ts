// The debounced localStorage scratch copy Planner.tsx keeps of whatever plan
// is on screen, for convenience across reloads. It is NOT the plan library
// (io/library.ts) and NOT the source of truth: plan JSON export/import is. A
// corrupted or version-mismatched scratch payload is treated exactly as
// "nothing saved yet" rather than surfaced as an error -- unlike a
// user-initiated import, this runs silently on every mount, and a stale entry
// from an old build must never block the app from loading.
//
// v2 wraps the plan as `{ plan, saved }` because the saved pairing has to
// survive a reload; without it every restored plan would report itself dirty.
// The v1 key held a bare plan, so it is read forward once on first load and
// nobody with in-progress work loses it on upgrade.
import { adoptIdsFrom } from '@/modules/planner/domain/plan'
import { parsePlan } from '@/modules/planner/domain/planIo'
import type { DeploymentPlan } from '@/modules/planner/domain/types'

export const SCRATCH_KEY = 'planner.scratch.v2'
export const LEGACY_AUTOSAVE_KEY = 'planner.autosave.v1'

export interface Scratch {
  plan: DeploymentPlan
  saved: { planId: string; rev: number } | null
}

// Validated rather than trusted: this payload is hand-editable, and a bad
// pairing that slipped through would report an unsaved plan as saved -- the
// worst failure this feature can have.
function readSavedPairing(value: unknown): { planId: string; rev: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const pairing = value as { planId?: unknown; rev?: unknown }
  if (typeof pairing.planId !== 'string' || pairing.planId.length === 0) return null
  if (typeof pairing.rev !== 'number' || !Number.isFinite(pairing.rev)) return null
  return { planId: pairing.planId, rev: pairing.rev }
}

export function loadScratch(): Scratch | null {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY)
    if (raw !== null) {
      const outer = JSON.parse(raw) as { plan?: unknown; saved?: unknown }
      // Re-stringified so parsePlan stays the one validator in the codebase.
      // JSON.stringify(undefined) yields undefined, which parsePlan's own
      // JSON.parse rejects -- so a payload with no `plan` at all is handled.
      const result = parsePlan(JSON.stringify(outer.plan))
      if (!result.ok) return null
      adoptIdsFrom(result.plan)
      return { plan: result.plan, saved: readSavedPairing(outer.saved) }
    }
    const legacy = localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (legacy === null) return null
    const result = parsePlan(legacy)
    if (!result.ok) return null
    adoptIdsFrom(result.plan)
    // saved is null: a migrated plan has never been written to the library,
    // so it is genuinely unsaved.
    return { plan: result.plan, saved: null }
  } catch (err) {
    console.error('[planner] could not read scratch', err)
    return null
  }
}
