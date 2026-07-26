// Plan JSON persistence: the source of truth for EXPORT PLAN / IMPORT PLAN
// and the payload localStorage autosave writes. Versioned via
// DeploymentPlan.schemaVersion so a plan saved by an older/newer build fails
// loudly (parsePlan's ok:false branch) instead of loading a shape this
// build doesn't understand.

import { PLAN_SCHEMA_VERSION } from './plan'
import { isValidAoiGeometry } from './geometry'
import { DOCK_MODELS, DRONES } from './catalog'
import type { DeploymentPlan } from './types'

export function serializePlan(plan: DeploymentPlan): string {
  return JSON.stringify(plan, null, 2)
}

export type ParseResult = { ok: true; plan: DeploymentPlan } | { ok: false; message: string }

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Blank and whitespace-only are rejected together: an id or name of "   " is
// indistinguishable from a missing one everywhere it is used (React keys,
// the plan tree's labels, adoptIdsFrom's suffix scan).
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// A GeoJSON position is [lon, lat] with an OPTIONAL third altitude element,
// so this checks "at least two, all finite" rather than "exactly two". A dock
// position is a different thing -- PlannedDock.position is typed
// [lon, lat] with no third slot -- and is checked separately below.
function isPositionArray(v: unknown): boolean {
  return Array.isArray(v) && v.length >= 2 && v.every(isFiniteNumber)
}

// Empty is rejected at every level. A Polygon with zero rings, or a ring with
// zero positions, is not something any AOI-entry path in this build can mint,
// and it does NOT get caught downstream: isValidAoiGeometry runs @turf/kinks,
// which finds no self-intersections in an empty ring and so reports
// `valid: true`, handing a degenerate shape to computeCoverage exactly as if
// it were a real area.
function isNestedCoordinateArray(v: unknown, depth: number): boolean {
  if (!Array.isArray(v) || v.length === 0) return false
  if (depth === 0) return v.every(isPositionArray)
  return v.every((child) => isNestedCoordinateArray(child, depth - 1))
}

const AOI_SOURCES = ['drawn', 'kml', 'kmz']
const DOCK_SOURCES = ['manual', 'auto']
const DOCK_ENVIRONMENTS = ['urban', 'rural']

// Shape gate, not a geometry gate. Ring closure, winding order and
// self-intersection are deliberately NOT checked here: isValidAoiGeometry
// (re-derived on the way out, below) and turf already own geometry quality,
// and an AOI that is well-shaped but self-intersecting must still load so the
// user sees it flagged INVALID in the tree rather than losing the whole file.
// For the same reason `valid` itself is not checked at all: whatever the file
// claims is discarded and recomputed from the geometry on the way out.
function isValidAoiShape(v: unknown): boolean {
  if (!isRecord(v)) return false
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.name)) return false
  if (typeof v.source !== 'string' || !AOI_SOURCES.includes(v.source)) return false
  if (v.simplifiedFrom !== undefined && !isFiniteNumber(v.simplifiedFrom)) return false
  const geometry = v.geometry
  if (!isRecord(geometry)) return false
  // Nesting depth is checked against the DECLARED type, so a MultiPolygon
  // carrying Polygon coordinates (or the reverse) is rejected rather than
  // admitted for turf to misread. Polygon: ring -> position (depth 1).
  // MultiPolygon: polygon -> ring -> position (depth 2).
  if (geometry.type === 'Polygon') return isNestedCoordinateArray(geometry.coordinates, 1)
  if (geometry.type === 'MultiPolygon') return isNestedCoordinateArray(geometry.coordinates, 2)
  return false
}

function isValidDockShape(v: unknown): boolean {
  if (!isRecord(v)) return false
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.name)) return false
  // Exactly two, unlike an AOI position: PlannedDock.position is typed
  // [lon, lat] with no altitude slot, so a third element means the file did
  // not come from this build.
  const position = v.position
  if (!Array.isArray(position) || position.length !== 2) return false
  if (!position.every(isFiniteNumber)) return false
  const [lon, lat] = position
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false
  if (typeof v.environment !== 'string' || !DOCK_ENVIRONMENTS.includes(v.environment)) return false
  if (typeof v.source !== 'string' || !DOCK_SOURCES.includes(v.source)) return false
  if (v.radiusKmOverride !== undefined && !isFiniteNumber(v.radiusKmOverride)) return false
  // dockModel/droneModel ARE checked for membership of domain/catalog.ts.
  //
  // The spec originally recorded the opposite as a non-goal, on the premise
  // that "the Inspector already handles an unknown or incompatible pairing".
  // That premise was verified and found false, so the decision was reversed:
  // the Inspector's fallback covers a model that IS in the catalog but paired
  // with an incompatible one (it re-adds the stored droneModel as a marked
  // "· INCOMPATIBLE" option with an alert badge). A model id absent from the
  // catalog entirely is not handled anywhere and THROWS during render --
  // catalog.ts's effectiveRadius does `DRONES[dock.droneModel].enduranceMin`
  // and Inspector.tsx does `DOCK_MODELS[dock.dockModel].drones`, both of
  // which are a TypeError on an unknown id. Admitting one here would trade a
  // rejected file for a crashed module.
  //
  // The forward-compatibility worry the original non-goal was protecting
  // against -- refusing a plan naming a model a NEWER build has shipped -- is
  // already covered upstream by the schemaVersion check, which rejects a
  // newer plan with a message that names the real problem. And types.ts
  // declares these as the narrow DockModelId/DroneModelId unions, so
  // admitting an off-catalog id would make this function's own
  // `p as DeploymentPlan` cast a lie.
  if (!isNonEmptyString(v.dockModel) || !isNonEmptyString(v.droneModel)) return false
  return v.dockModel in DOCK_MODELS && v.droneModel in DRONES
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

  // Element-level validation. The comment that used to sit here claimed a
  // malformed element "fails safely downstream". It did not, and that was the
  // whole gap. parsePlan's OWN return path (bottom of this function) runs
  // `plan.aois.map((aoi) => ({ ...aoi, valid: isValidAoiGeometry(aoi.geometry) }))`,
  // so a file containing `{"aois":[null], ...}` threw a TypeError -- "Cannot
  // read properties of null (reading 'geometry')" -- INSIDE parsePlan, before
  // any downstream code got a chance to be safe about it. On the autosave
  // path loadAutosave's try/catch swallowed that and silently degraded to "no
  // saved plan"; on the IMPORT PLAN path there is no try/catch at all, so it
  // surfaced as an unhandled rejection out of an async handler and the user
  // saw nothing happen. Elements that did NOT throw were admitted verbatim: a
  // dock with a three-element position, a latitude of 900, a blank id, an
  // `environment` of "suburban" all reached the map, the inspector and
  // autoPlace as though they were well formed.
  //
  // A single bad element rejects the WHOLE file. Dropping the offender and
  // returning the rest was considered and rejected: handing back a plan
  // smaller than the one the customer opened, with nothing on screen saying
  // an area or a dock was discarded, is a worse failure than refusing to load
  // it. The message names the index so the offending element can be found in
  // the file by hand.
  for (let i = 0; i < p.aois.length; i += 1) {
    if (!isValidAoiShape(p.aois[i])) {
      return { ok: false, message: `PLAN CONTAINS AN INVALID AREA AT INDEX ${i}` }
    }
  }
  for (let i = 0; i < p.docks.length; i += 1) {
    if (!isValidDockShape(p.docks[i])) {
      return { ok: false, message: `PLAN CONTAINS AN INVALID DOCK AT INDEX ${i}` }
    }
  }

  const plan = p as DeploymentPlan

  // Minor 4 (final whole-branch review): this is the one function BOTH
  // paths that admit a plan from outside the current session -- ui/
  // Planner.tsx's loadAutosave() and its IMPORT PLAN handler -- already
  // call, so re-deriving aoi.valid HERE covers both at once rather than
  // needing the same fix twice. Before this, `aoi.valid` was accepted
  // verbatim from the file: a plan autosaved by a pre-fix build (or a
  // hand-edited/IMPORTed one) could carry a self-intersecting AOI recorded
  // as `valid: true`, which then reached computeCoverage exactly as if
  // Important 4's isValidAoiGeometry check had never been applied to it at
  // all, collapsing the entire coverage result to `{ ok: false, reason:
  // 'degenerate' }` for the whole plan, not just the one bad AOI. The
  // KML-import (io/kml.ts) and draw-commit (ui/Planner.tsx's
  // handleDrawFinish) paths already compute this correctly at the point an
  // AOI is minted, so re-deriving it again here is redundant but harmless
  // for those; it is load-bearing for a plan that arrives with `valid`
  // already set by something other than this build's own AOI-entry paths.
  return {
    ok: true,
    plan: {
      ...plan,
      aois: plan.aois.map((aoi) => ({ ...aoi, valid: isValidAoiGeometry(aoi.geometry) })),
    },
  }
}
