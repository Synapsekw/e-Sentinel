import type { Aoi, DeploymentPlan, PlannedDock } from './types'

export const PLAN_SCHEMA_VERSION = 1
export const DEFAULT_PARAMS = { targetOverlapPct: 20, requiredCoveragePct: 95 }

// Monotonic counter, NOT Math.random or Date.now: ids must be reproducible
// so auto-placement output can be asserted byte-for-byte in tests.
let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}
export function resetIdsForTest(): void {
  seq = 0
}

// The counter above is process-local and resets on every page load, while a
// plan can outlive the process (localStorage autosave, IMPORT PLAN, KML
// import) or arrive from another session entirely. Ids are shaped
// `prefix-N`, but seq itself is NOT prefix-scoped -- every prefix mints off
// the same counter -- so the only thing that matters to avoid a collision is
// the highest N used by ANY id already in the plan, regardless of its
// prefix. Call this on every path that hands the app a plan it did not mint
// itself, before any further nextId() calls happen against it.
function highestSuffix(id: string): number {
  const dash = id.lastIndexOf('-')
  if (dash === -1 || dash === id.length - 1) return -1
  const suffix = id.slice(dash + 1)
  if (!/^\d+$/.test(suffix)) return -1
  const n = Number(suffix)
  return Number.isSafeInteger(n) ? n : -1
}

export function adoptIdsFrom(plan: Pick<DeploymentPlan, 'aois' | 'docks'>): void {
  let maxSeen = -1
  for (const aoi of plan.aois) maxSeen = Math.max(maxSeen, highestSuffix(aoi.id))
  for (const dock of plan.docks) maxSeen = Math.max(maxSeen, highestSuffix(dock.id))
  seq = Math.max(seq, maxSeen)
}

// Wall-clock reads make the otherwise-pure domain layer non-reproducible, which
// is the same problem nextId solves for ids. Tests pin this so a mutation can be
// asserted byte-for-byte; production leaves it alone.
let now = (): string => new Date().toISOString()

export function setNowForTest(fn: () => string): void {
  now = fn
}

export function resetNowForTest(): void {
  now = () => new Date().toISOString()
}

function bump(plan: DeploymentPlan, patch: Partial<DeploymentPlan>): DeploymentPlan {
  return { ...plan, ...patch, rev: plan.rev + 1, updatedAt: now() }
}

export function createPlan(opts?: {
  name?: string
  customer?: string
  now?: string
}): DeploymentPlan {
  const createdAt = opts?.now ?? now()
  return {
    id: nextId('plan'),
    name: opts?.name ?? 'UNTITLED PLAN',
    customer: opts?.customer ?? '',
    createdAt,
    updatedAt: createdAt,
    schemaVersion: PLAN_SCHEMA_VERSION,
    aois: [],
    docks: [],
    params: { ...DEFAULT_PARAMS },
    rev: 0,
  }
}

export const addAoi = (p: DeploymentPlan, aoi: Aoi) => bump(p, { aois: [...p.aois, aoi] })
export const removeAoi = (p: DeploymentPlan, id: string) =>
  bump(p, { aois: p.aois.filter((a) => a.id !== id) })
export const addDock = (p: DeploymentPlan, dock: PlannedDock) =>
  bump(p, { docks: [...p.docks, dock] })
export const removeDock = (p: DeploymentPlan, id: string) =>
  bump(p, { docks: p.docks.filter((d) => d.id !== id) })
export const updateDock = (p: DeploymentPlan, id: string, patch: Partial<PlannedDock>) =>
  bump(p, { docks: p.docks.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
export const setDocks = (p: DeploymentPlan, docks: PlannedDock[]) => bump(p, { docks: [...docks] })
export const setParams = (p: DeploymentPlan, params: DeploymentPlan['params']) =>
  bump(p, { params: { ...params } })

// ---------------------------------------------------------------------------
// Naming.
//
// Both dock-creation paths used to name independently -- map/useDockPlacement's
// `DOCK NN` and autoPlace's `PROPOSED <lon> <lat>` -- and both numbered off
// `array.length + 1`, which collides after a removal: DOCK 01 + DOCK 03 is
// length 2, so length+1 mints a SECOND DOCK 03. Numbering off the highest
// number actually present cannot collide, whatever has been removed or renamed.
//
// These are explicit helpers rather than logic inside addAoi/addDock on
// purpose: handleImportPlanFile and loadAutosave reach the store through
// setPlan, not through those setters, so a rename hidden inside addAoi would
// silently apply to KML import and not to plan import. Imported and autosaved
// plans keep their names verbatim -- renaming a user's saved plan on load
// would be a data change wearing a polish fix's clothes.
// ---------------------------------------------------------------------------

function highestNumbered(names: readonly string[], pattern: RegExp): number {
  let max = 0
  for (const name of names) {
    const m = pattern.exec(name.trim())
    if (!m) continue
    const n = Number(m[1])
    if (Number.isSafeInteger(n) && n > max) max = n
  }
  return max
}

const DOCK_NAME_RE = /^DOCK\s+(\d+)$/i
const AOI_NAME_RE = /^AOI\s+(\d+)$/i

// `DOCK 01`, `DOCK 02`, ... Zero-padded to two digits so a dock list sorts and
// aligns; three-digit plans simply grow past the padding.
export function nextDockName(plan: Pick<DeploymentPlan, 'docks'>): string {
  const n =
    highestNumbered(
      plan.docks.map((d) => d.name),
      DOCK_NAME_RE,
    ) + 1
  return `DOCK ${String(n).padStart(2, '0')}`
}

// `AOI 1`, `AOI 2`, ... Unpadded, matching the label the draw path has always
// produced. Imported names like `AOI ONE` do not match the pattern and so
// never contribute to the count.
export function nextAoiName(plan: Pick<DeploymentPlan, 'aois'>): string {
  return `AOI ${
    highestNumbered(
      plan.aois.map((a) => a.name),
      AOI_NAME_RE,
    ) + 1
  }`
}

// For names the app does not generate and should preserve where it can -- a
// KML placemark's own name, above all. Importing one file twice used to yield
// two identically-named areas, indistinguishable in the plan tree.
export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} (${n})`)) n += 1
  return `${base} (${n})`
}
