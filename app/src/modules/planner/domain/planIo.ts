// Plan JSON persistence: the source of truth for EXPORT PLAN / IMPORT PLAN
// and the payload localStorage autosave writes. Versioned via
// DeploymentPlan.schemaVersion so a plan saved by an older/newer build fails
// loudly (parsePlan's ok:false branch) instead of loading a shape this
// build doesn't understand.

import { PLAN_SCHEMA_VERSION } from './plan'
import type { DeploymentPlan } from './types'

export function serializePlan(plan: DeploymentPlan): string {
  return JSON.stringify(plan, null, 2)
}

export type ParseResult = { ok: true; plan: DeploymentPlan } | { ok: false; message: string }

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// Coverage-params bounds mirrored from PlanTree.tsx's sliders (min/max on the
// targetOverlapPct / requiredCoveragePct <input type="range"> elements): a
// plan whose params fall outside what the UI could ever produce is exactly
// as untrustworthy as one missing a field outright. This also closes the
// Critical 3 hang: targetOverlapPct >= 100 drives autoPlace.ts's
// initialSpacingKm to zero or negative, which -- independently of this
// validation, see buildLattice's own defensive bail -- would never
// terminate the lattice loop.
const MIN_TARGET_OVERLAP_PCT = 0
const MAX_TARGET_OVERLAP_PCT = 80
const MIN_REQUIRED_COVERAGE_PCT = 50
const MAX_REQUIRED_COVERAGE_PCT = 100

const REQUIRED_STRING_FIELDS: (keyof DeploymentPlan)[] = [
  'id',
  'name',
  'customer',
  'createdAt',
  'updatedAt',
]

export function parsePlan(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, message: 'FILE IS NOT VALID JSON' }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'FILE IS NOT A PLAN' }
  const p = raw as Partial<DeploymentPlan>
  if (!Array.isArray(p.aois) || !Array.isArray(p.docks) || typeof p.schemaVersion !== 'number') {
    return { ok: false, message: 'FILE IS NOT A PLAN' }
  }
  if (p.schemaVersion > PLAN_SCHEMA_VERSION) {
    return { ok: false, message: `PLAN SCHEMA ${p.schemaVersion} IS NEWER THAN THIS BUILD` }
  }

  // Finding 3 (final whole-branch review): a plan missing `params` used to
  // slip through here, then crash the whole SPA the moment PlanTree.tsx read
  // plan.params.targetOverlapPct during render (a TypeError, not the "renders
  // oddly" this comment used to (wrongly) claim), and a plan whose
  // targetOverlapPct was >= 100 would reach autoPlace.ts and hang the tab on
  // a lattice loop that could never advance. Every field the app actually
  // reads off an imported plan is validated here instead, so a malformed or
  // hand-edited file is rejected outright, with a clear reason, rather than
  // admitted and left to fail somewhere downstream.
  for (const key of REQUIRED_STRING_FIELDS) {
    if (typeof p[key] !== 'string') {
      return { ok: false, message: `FILE IS NOT A PLAN · MISSING OR INVALID "${key}"` }
    }
  }
  if (!isFiniteNumber(p.rev)) {
    return { ok: false, message: 'FILE IS NOT A PLAN · MISSING OR INVALID "rev"' }
  }

  const params = p.params
  if (
    typeof params !== 'object' ||
    params === null ||
    !isFiniteNumber(params.targetOverlapPct) ||
    !isFiniteNumber(params.requiredCoveragePct)
  ) {
    return { ok: false, message: 'FILE IS NOT A PLAN · MISSING OR INVALID COVERAGE PARAMETERS' }
  }
  if (
    params.targetOverlapPct < MIN_TARGET_OVERLAP_PCT ||
    params.targetOverlapPct > MAX_TARGET_OVERLAP_PCT
  ) {
    return {
      ok: false,
      message: `TARGET OVERLAP MUST BE BETWEEN ${MIN_TARGET_OVERLAP_PCT} AND ${MAX_TARGET_OVERLAP_PCT} PERCENT`,
    }
  }
  if (
    params.requiredCoveragePct < MIN_REQUIRED_COVERAGE_PCT ||
    params.requiredCoveragePct > MAX_REQUIRED_COVERAGE_PCT
  ) {
    return {
      ok: false,
      message: `REQUIRED COVERAGE MUST BE BETWEEN ${MIN_REQUIRED_COVERAGE_PCT} AND ${MAX_REQUIRED_COVERAGE_PCT} PERCENT`,
    }
  }

  // aois/docks are checked above only for being arrays; their element shape
  // (geometry, position, ids) is not individually validated. That is an
  // intentional scope limit, not the same gap this fix closes: a malformed
  // element there fails safely downstream (computeCoverage's try/catch, the
  // INVALID-AOI badge) rather than crashing render or hanging a loop the way
  // a missing/out-of-range params did.
  return { ok: true, plan: p as DeploymentPlan }
}
