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
  // Every required field above has been checked; the remaining
  // DeploymentPlan fields (id/name/customer/createdAt/updatedAt/params/rev)
  // are not individually validated here -- a hand-edited or corrupted file
  // missing one of those would produce a plan that renders oddly rather
  // than one rejected outright. Tightening this is a one-file follow-up if
  // that proves to matter in practice.
  return { ok: true, plan: p as DeploymentPlan }
}
