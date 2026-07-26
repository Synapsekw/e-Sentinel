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
import bbox from '@turf/bbox'
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

// A self-intersecting ring is not just excluded from coverage -- MapLibre's
// GeoJSON tiler drops it outright, so planner-aoi-fill and planner-aoi-line
// receive no feature and the area is INVISIBLE on the map. The user draws a
// shape and nothing appears where they drew it.
//
// The tiler does accept an axis-aligned rectangle, so an invalid area is
// rendered from this stand-in instead (see map/plannerStyle.ts's
// aoiFeatures). A bounding box rather than a convex hull on purpose: a hull
// hugs the drawn points closely enough to look like a plausible AOI, which
// risks reading as the polygon that actually got committed. A rectangle
// plainly is not what anyone drew, which is the honest signal for an error
// state.
export function aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null {
  let bounds: number[]
  try {
    bounds = bbox(feature(geometry))
  } catch (err) {
    // Folded into null rather than thrown, matching isValidAoiGeometry
    // above: a caller building a render feature is not expecting an
    // exception from a geometry it already knows is bad.
    console.error('[planner] bbox() threw while bounding an invalid AOI, rendering nothing', err)
    return null
  }
  const [minX, minY, maxX, maxY] = bounds
  // A zero-width or zero-height box paints nothing anyway, so returning one
  // would claim a fix that isn't there. null means "no renderable stand-in
  // exists"; the area keeps its INVALID badge in the plan tree either way.
  if (!bounds.every(Number.isFinite)) return null
  if (minX === maxX || minY === maxY) return null
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  }
}
