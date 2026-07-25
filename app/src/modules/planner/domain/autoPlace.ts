import bbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { feature, featureCollection, point } from '@turf/helpers'
import union from '@turf/union'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { computeCoverage } from './coverage'
import { effectiveRadius } from './catalog'
import { nextId, setDocks } from './plan'
import type { DeploymentPlan, DroneModelId, PlannedDock } from './types'

export const MAX_DOCKS = 40
export const MIN_MARGINAL_GAIN_PCT = 0.25
export const SAMPLE_SPACING_DIVISOR = 4
export const MAX_SAMPLE_POINTS = 20000

export interface SuggestResult {
  docks: PlannedDock[]
  achievedPct: number
  stoppedBy: 'target' | 'cap' | 'gain'
}

const KM_PER_DEG_LAT = 111.2
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180)

function makeDock(lon: number, lat: number, droneModel: DroneModelId): PlannedDock {
  return {
    id: nextId('dock'),
    name: `PROPOSED ${lon.toFixed(3)} ${lat.toFixed(3)}`,
    position: [lon, lat],
    dockModel: droneModel === 'M350' ? 'DOCK2' : 'DOCK3',
    droneModel,
    environment: 'rural',
    source: 'auto',
  }
}

export function suggestLayout(
  plan: DeploymentPlan,
  opts?: { droneModel?: DroneModelId },
): SuggestResult {
  const droneModel = opts?.droneModel ?? 'M4TD'
  const valid = plan.aois.filter((a) => a.valid)
  if (valid.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const aoiGeom = valid
    .map((a) => feature(a.geometry))
    .reduce<Feature<Polygon | MultiPolygon> | null>(
      (acc, f) => (acc ? union(featureCollection([acc, f])) : f),
      null,
    )
  if (!aoiGeom) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const radiusKm = effectiveRadius(makeDock(0, 0, droneModel)).radiusKm
  const [minLon, minLat, maxLon, maxLat] = bbox(aoiGeom)
  const midLat = (minLat + maxLat) / 2

  // Hex lattice anchored to the bbox MINIMUM corner. Never a centroid or a
  // random origin: the anchor is what makes the whole thing reproducible.
  const spacingKm = radiusKm * Math.sqrt(3) * (1 - plan.params.targetOverlapPct / 100)
  const dLat = spacingKm / KM_PER_DEG_LAT
  const dLon = spacingKm / kmPerDegLon(midLat)

  const candidates: [number, number][] = []
  let row = 0
  for (let lat = minLat; lat <= maxLat + dLat; lat += dLat, row += 1) {
    const offset = row % 2 === 0 ? 0 : dLon / 2 // hex stagger
    for (let lon = minLon + offset; lon <= maxLon + dLon; lon += dLon) {
      if (booleanPointInPolygon(point([lon, lat]), aoiGeom)) candidates.push([lon, lat])
    }
  }
  // Stable ordering: lat then lon ascending, so ties break identically.
  candidates.sort((a, b) => a[1] - b[1] || a[0] - b[0])

  // Rasterized sample grid for greedy scoring. Running an exact turf union per
  // candidate per iteration would be hundreds of polygon ops and would hang
  // the tab; one exact coverage computation runs at the end instead.
  let sampleSpacingKm = radiusKm / SAMPLE_SPACING_DIVISOR
  let samples: [number, number][] = []
  for (;;) {
    samples = []
    const sLat = sampleSpacingKm / KM_PER_DEG_LAT
    const sLon = sampleSpacingKm / kmPerDegLon(midLat)
    for (let lat = minLat; lat <= maxLat; lat += sLat) {
      for (let lon = minLon; lon <= maxLon; lon += sLon) {
        if (booleanPointInPolygon(point([lon, lat]), aoiGeom)) samples.push([lon, lat])
      }
    }
    if (samples.length <= MAX_SAMPLE_POINTS) break
    sampleSpacingKm *= 1.5 // widen deterministically, then re-sample
  }
  if (samples.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const covered = new Array<boolean>(samples.length).fill(false)
  const withinRadius = (c: [number, number], s: [number, number]): boolean => {
    const dy = (s[1] - c[1]) * KM_PER_DEG_LAT
    const dx = (s[0] - c[0]) * kmPerDegLon(midLat)
    return dx * dx + dy * dy <= radiusKm * radiusKm
  }

  const chosen: [number, number][] = []
  let stoppedBy: SuggestResult['stoppedBy'] = 'gain'
  const total = samples.length

  for (;;) {
    if (chosen.length >= MAX_DOCKS) {
      stoppedBy = 'cap'
      break
    }
    const coveredCount = covered.filter(Boolean).length
    if ((coveredCount / total) * 100 >= plan.params.requiredCoveragePct) {
      stoppedBy = 'target'
      break
    }

    let bestIdx = -1
    let bestGain = 0
    for (let i = 0; i < candidates.length; i += 1) {
      let gain = 0
      for (let s = 0; s < samples.length; s += 1) {
        if (!covered[s] && withinRadius(candidates[i], samples[s])) gain += 1
      }
      if (gain > bestGain) {
        bestGain = gain
        bestIdx = i
      }
    }

    if (bestIdx < 0 || (bestGain / total) * 100 < MIN_MARGINAL_GAIN_PCT) {
      stoppedBy = 'gain'
      break
    }

    const pick = candidates[bestIdx]
    chosen.push(pick)
    candidates.splice(bestIdx, 1)
    for (let s = 0; s < samples.length; s += 1) {
      if (!covered[s] && withinRadius(pick, samples[s])) covered[s] = true
    }
  }

  const docks = chosen.map(([lon, lat]) => makeDock(lon, lat, droneModel))
  const exact = computeCoverage(setDocks(plan, docks))
  return { docks, achievedPct: exact.ok ? exact.coveragePct : 0, stoppedBy }
}
