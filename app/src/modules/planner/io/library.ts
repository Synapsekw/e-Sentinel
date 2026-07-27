// The plan library's storage layer: many named plans in localStorage, one key
// per plan, keyed by plan id.
//
// A library entry IS a DeploymentPlan serialized by domain/planIo.ts's
// serializePlan and validated on the way back by its parsePlan. There is no
// second format and no second validator, so everything planIo already
// guarantees -- the schemaVersion gate, the coverage-params bounds, per-element
// aoi/dock shape checks, the aoi.valid re-derivation -- covers library reads
// for free, and a file written by EXPORT PLAN loads here unchanged.
//
// One key per plan rather than one array under a single key: a plan carrying
// imported KML can be hundreds of KB, so a save must rewrite only that plan; a
// QuotaExceededError is then scoped to the plan being saved; and one corrupt
// entry cannot take the whole library down.
//
// `Storage` is a parameter, never `window.localStorage` reached for directly,
// so the tests can drive a fake -- which is the only way the quota path and the
// private-window refusal are reachable at all.
import { serializePlan, parsePlan } from '../domain/planIo'
import type { ParseResult } from '../domain/planIo'
import type { DeploymentPlan } from '../domain/types'

export const LIBRARY_PREFIX = 'planner.library.v1.'

export interface LibraryListing {
  entries: DeploymentPlan[]
  skipped: number
}

export type SaveResult = { ok: true } | { ok: false; message: string }

// Collected into an array up front rather than read lazily during iteration:
// no current caller mutates storage while scanning, but this keeps it safe
// if one someday does.
function libraryKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && key.startsWith(LIBRARY_PREFIX)) keys.push(key)
  }
  return keys
}

export function listPlans(storage: Storage): LibraryListing {
  const entries: DeploymentPlan[] = []
  let skipped = 0
  for (const key of libraryKeys(storage)) {
    const raw = storage.getItem(key)
    if (raw === null) {
      skipped += 1
      continue
    }
    const result = parsePlan(raw)
    if (!result.ok) {
      skipped += 1
      continue
    }
    // The key is derived from plan.id on every write, so an entry whose id
    // does not match its key did not come from this build. Counted as
    // corruption rather than admitted: it would otherwise appear in the list
    // as a row that deletePlan(entry.id) cannot remove.
    if (key.slice(LIBRARY_PREFIX.length) !== result.plan.id) {
      skipped += 1
      continue
    }
    entries.push(result.plan)
  }
  // Plain comparison, not localeCompare: ISO-8601 sorts correctly as a byte
  // string, and localeCompare's ordering depends on the runtime's locale,
  // which nothing here pins.
  entries.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return { entries, skipped }
}

export function readPlan(storage: Storage, id: string): ParseResult {
  const raw = storage.getItem(LIBRARY_PREFIX + id)
  if (raw === null) return { ok: false, message: 'PLAN NOT IN LIBRARY' }
  return parsePlan(raw)
}

export function hasPlan(storage: Storage, id: string): boolean {
  return storage.getItem(LIBRARY_PREFIX + id) !== null
}

export function savePlan(storage: Storage, plan: DeploymentPlan): SaveResult {
  // Serialized OUTSIDE the try so only the storage write is guarded: a
  // serialization failure is a bug in this build, not a full disk, and must
  // never be reported to the user as one.
  const json = serializePlan(plan)
  try {
    storage.setItem(LIBRARY_PREFIX + plan.id, json)
    return { ok: true }
  } catch (err) {
    // Logged as well as returned. The message alone is not enough to
    // reproduce a failure from a bug report, and a save that fails during a
    // live demo is exactly when the console matters.
    console.error('[planner] could not save plan to library', plan.id, err)
    // QuotaExceededError is the expected failure for a ~5MB store holding
    // KML-derived geometry. Anything else (SecurityError from a locked-down
    // browser, for instance) is a different problem and must not claim the
    // disk is full.
    const full = err instanceof DOMException && err.name === 'QuotaExceededError'
    return {
      ok: false,
      message: full
        ? `COULD NOT SAVE "${plan.name}" · BROWSER STORAGE IS FULL`
        : `COULD NOT SAVE "${plan.name}"`,
    }
  }
}

export function deletePlan(storage: Storage, id: string): void {
  storage.removeItem(LIBRARY_PREFIX + id)
}
