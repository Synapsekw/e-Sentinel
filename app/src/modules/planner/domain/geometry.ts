// Self-intersection check for AOI geometry. Important 4 (final whole-branch
// review): before this existed, the ONLY way an AOI ever became `valid:
// false` was io/kml.ts's simplify-threshold branch throwing (which only
// happens above SIMPLIFY_VERTEX_THRESHOLD vertices) -- map/useAoiDraw.ts's
// draw-commit path never set validity at all, always defaulting to `true`.
// A self-intersecting ring (imported, or occasionally drawn) reached
// computeCoverage as `valid: true`, and turf's union()/intersect() over a
// self-intersecting polygon reliably collapses the ENTIRE coverage result to
// `{ ok: false, reason: 'degenerate' }` -- one bad AOI poisons every other
// AOI in the plan, the opposite of the design doc section 11's requirement
// to exclude the one bad AOI and flag it.
//
// This is called at every point a polygon can join a plan: io/kml.ts's
// import path and ui/Planner.tsx's draw-commit path (handleDrawFinish). The
// `valid` flag itself, the INVALID badge in PlanTree.tsx and the inspector
// banner in Inspector.tsx were already built and correct -- only the code
// that SETS the flag was missing here.
import kinks from '@turf/kinks'
import { feature } from '@turf/helpers'
import type { MultiPolygon, Polygon } from 'geojson'

export function isValidAoiGeometry(geometry: Polygon | MultiPolygon): boolean {
  try {
    return kinks(feature(geometry)).features.length === 0
  } catch (err) {
    // A geometry turf's own kinks() cannot even parse (e.g. a ring collapsed
    // to fewer than the minimum points a Polygon needs) is not valid either
    // -- fold that into the same false result instead of letting it throw
    // into a caller that isn't expecting one, matching how coverage.ts and
    // kml.ts's own maybeSimplify already treat a thrown turf error as
    // "invalid", not a crash.
    console.error('[planner] kinks() threw while validating AOI geometry, treating as invalid', err)
    return false
  }
}
