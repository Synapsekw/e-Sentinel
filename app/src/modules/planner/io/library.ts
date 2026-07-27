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

// The envelope's own version, deliberately NOT PLAN_SCHEMA_VERSION: the shape
// of the wrapper and the shape of a plan evolve independently, and conflating
// them would force a library-format bump every time a plan field changes. Each
// plan inside still carries and is validated against its own schemaVersion.
export const LIBRARY_VERSION = 1

export type ImportResult =
  { ok: true; imported: number; skipped: number } | { ok: false; message: string }

export interface LibraryExport {
  json: string
  // Entries present in the library but unreadable, so absent from `json`. The
  // caller MUST surface this: an export is what a user relies on before
  // clearing their browser, and a backup that is quietly short is worse than
  // one that fails loudly.
  skipped: number
}

// `now` is a parameter rather than a `new Date()` read, matching domain/plan.ts's
// setNowForTest philosophy: the export payload stays byte-assertable in tests.
export function exportLibrary(storage: Storage, now: string): LibraryExport {
  const listing = listPlans(storage)
  return {
    json: JSON.stringify(
      {
        libraryVersion: LIBRARY_VERSION,
        exportedAt: now,
        plans: listing.entries,
      },
      null,
      2,
    ),
    skipped: listing.skipped,
  }
}

export function importLibrary(storage: Storage, json: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, message: 'FILE IS NOT VALID JSON' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'FILE IS NOT A PLAN LIBRARY' }
  }
  const envelope = raw as { libraryVersion?: unknown; plans?: unknown }
  if (typeof envelope.libraryVersion !== 'number' || !Array.isArray(envelope.plans)) {
    return { ok: false, message: 'FILE IS NOT A PLAN LIBRARY' }
  }
  if (envelope.libraryVersion > LIBRARY_VERSION) {
    return {
      ok: false,
      message: `LIBRARY VERSION ${envelope.libraryVersion} IS NEWER THAN THIS BUILD`,
    }
  }

  // Each plan is validated individually and the good ones land. This is a
  // DELIBERATE divergence from parsePlan's all-or-nothing stance on a single
  // plan: the elements of one plan are parts of one object, whereas a library
  // is a bag of independent plans, and refusing fifty because one is malformed
  // helps nobody. The skipped count is always reported, never swallowed.
  let skipped = 0
  // Distinct ids, not raw successes: two entries in one file sharing an id
  // overwrite each other, so only one plan lands and the count must say one.
  const written = new Set<string>()
  for (const entry of envelope.plans) {
    // Re-stringified so the one validator in the codebase does the work,
    // rather than growing a second object-shaped copy of parsePlan here.
    const result = parsePlan(JSON.stringify(entry))
    if (!result.ok) {
      skipped += 1
      continue
    }
    if (savePlan(storage, result.plan).ok) written.add(result.plan.id)
    else skipped += 1
  }
  return { ok: true, imported: written.size, skipped }
}
