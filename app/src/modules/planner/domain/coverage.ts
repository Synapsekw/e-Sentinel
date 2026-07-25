import buffer from '@turf/buffer'
import union from '@turf/union'
import intersect from '@turf/intersect'
import difference from '@turf/difference'
import area from '@turf/area'
import { featureCollection, feature } from '@turf/helpers'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { effectiveRadius } from './catalog'
import type { CoverageResult, DeploymentPlan, PlannedDock } from './types'

// Circles at 8 steps (turf's default) are visibly octagonal at working zoom.
export const BUFFER_STEPS = 64

type Poly = Feature<Polygon | MultiPolygon>

// turf 7 takes a FeatureCollection, NOT two positional features. The v6
// two-argument signature is what most online examples still show.
function unionAll(polys: Poly[]): Poly | null {
  if (polys.length === 0) return null
  if (polys.length === 1) return polys[0]
  return union(featureCollection(polys))
}

function dockBuffer(dock: PlannedDock): Poly | null {
  const { radiusKm } = effectiveRadius(dock)
  if (radiusKm <= 0) return null
  const pt = feature({ type: 'Point', coordinates: dock.position } as const)
  return buffer(pt, radiusKm, { units: 'kilometers', steps: BUFFER_STEPS }) ?? null
}

const km2 = (f: Poly | null): number => (f ? area(f) / 1_000_000 : 0)

export function computeCoverage(plan: DeploymentPlan): CoverageResult {
  const valid = plan.aois.filter((a) => a.valid)
  if (valid.length === 0) return { ok: false, reason: 'no-aoi' }
  if (plan.docks.length === 0) return { ok: false, reason: 'no-docks' }

  const aoiGeom = unionAll(valid.map((a) => feature(a.geometry)))
  if (!aoiGeom) return { ok: false, reason: 'degenerate' }
  const aoiKm2 = km2(aoiGeom)
  if (aoiKm2 <= 0) return { ok: false, reason: 'degenerate' }

  const buffers = plan.docks
    .map((d) => ({ dock: d, geom: dockBuffer(d) }))
    .filter((b): b is { dock: PlannedDock; geom: Poly } => b.geom !== null)
  if (buffers.length === 0) return { ok: false, reason: 'degenerate' }

  const coverageGeom = unionAll(buffers.map((b) => b.geom))
  if (!coverageGeom) return { ok: false, reason: 'degenerate' }

  const covered = intersect(featureCollection([coverageGeom, aoiGeom]))
  const coveredKm2 = km2(covered)
  const coveragePct = (coveredKm2 / aoiKm2) * 100

  const uncoveredFeature = difference(featureCollection([aoiGeom, coverageGeom]))
  const uncovered: MultiPolygon = !uncoveredFeature
    ? { type: 'MultiPolygon', coordinates: [] }
    : uncoveredFeature.geometry.type === 'Polygon'
      ? { type: 'MultiPolygon', coordinates: [uncoveredFeature.geometry.coordinates] }
      : uncoveredFeature.geometry

  // Strict overlap: the union of all PAIRWISE buffer intersections, clipped to
  // the AOI. The cheap alternative (sum of dock areas minus the union) counts
  // triple-covered ground twice, which would overstate the number.
  const pairwise: Poly[] = []
  for (let i = 0; i < buffers.length; i += 1) {
    for (let j = i + 1; j < buffers.length; j += 1) {
      const lens = intersect(featureCollection([buffers[i].geom, buffers[j].geom]))
      if (lens) pairwise.push(lens)
    }
  }
  const multiCovered = unionAll(pairwise)
  const multiInAoi = multiCovered ? intersect(featureCollection([multiCovered, aoiGeom])) : null
  const overlapPct = coveredKm2 > 0 ? (km2(multiInAoi) / coveredKm2) * 100 : 0

  const perDock = buffers.map((b) => ({
    dockId: b.dock.id,
    contributionKm2: km2(intersect(featureCollection([b.geom, aoiGeom]))),
  }))

  return {
    ok: true,
    aoiKm2,
    coveragePct,
    overlapPct,
    uncovered,
    gapCount: uncovered.coordinates.length,
    perDock,
  }
}
