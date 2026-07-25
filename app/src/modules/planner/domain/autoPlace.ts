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
// The old MIN_MARGINAL_GAIN_PCT floor measured a candidate's marginal gain
// as a percentage of *total AOI area*. That is not scale-invariant: a rural
// dock's own footprint (pi * radiusKm^2, ~78.5km^2 at the 5km rural radius)
// is a fixed quantity, so as the AOI grows past ~31,400km^2 a single dock's
// entire footprint is already below 0.25% of the total area -- the loop
// rejected its first candidate and returned zero docks with no explanation
// (see the design doc section 8 and the "places docks on a very large AOI"
// test below for the measured failure).
//
// The replacement floor is a plain count of sample-grid cells, not a
// percentage of anything. Why not "a fraction of one dock's own footprint,"
// which is what an earlier revision of this fix used: the sample grid's own
// resolution (sampleSpacingKm = radiusKm / SAMPLE_SPACING_DIVISOR) is
// derived from that same radiusKm, so radiusKm cancels out of "one dock's
// footprint, expressed in sample cells":
//
//   dockFootprintSamples = (pi * radiusKm^2) / (radiusKm / SAMPLE_SPACING_DIVISOR)^2
//                        = pi * SAMPLE_SPACING_DIVISOR^2
//
// which is a near-constant ~50.3 cells at the current SAMPLE_SPACING_DIVISOR
// (4), independent of AOI size or dock radius (see the "pins the dock-
// footprint-in-samples relationship" test in autoPlace.test.ts, which pins
// this exact algebra so a change to SAMPLE_SPACING_DIVISOR cannot silently
// change what this constant means). A "2% of footprint" framing on top of
// that near-constant was never actually scale-sensitive; it always reduced
// to "reject a candidate whose best gain is 0 or 1 sample cell," just dressed
// up as a percentage that suggested more rigor than the rule has. Naming the
// floor directly in the unit the greedy loop already scores gain in --
// sample cells -- is honest about that: a candidate must cover at least this
// many still-uncovered sample cells to be worth placing. This is not free of
// SAMPLE_SPACING_DIVISOR either: one sample cell's ground area is
// sampleSpacingKm^2, so a coarser divisor makes each cell (and so this floor,
// in real km^2) larger. 2 is the value that reproduces the 20km-box
// fixture's pre-existing, already-validated quality (11 docks, 97.63%
// coverage, stoppedBy 'target' -- see the "covers a 20km box"/"reaches the
// default required coverage" tests) while remaining a fixed,
// AOI-size-independent quantity, so it no longer blows up on a large AOI the
// way the old percent-of-total-area floor did.
export const MIN_MARGINAL_GAIN_SAMPLES = 2
export const SAMPLE_SPACING_DIVISOR = 4
export const MAX_SAMPLE_POINTS = 20000
export const MAX_CANDIDATES = 2000
export const MAX_REFINEMENTS = 3

// Deterministic widen/narrow factors. Widening keeps the candidate lattice
// under MAX_CANDIDATES the same way sample spacing is kept under
// MAX_SAMPLE_POINTS; refining halves spacing to add more candidate sites
// once the coarser lattice has been exhausted.
const CANDIDATE_SPACING_WIDEN_FACTOR = 1.5
const REFINEMENT_SPACING_FACTOR = 0.5

// Tolerance for treating two lattice points as "the same site" when a
// refined (finer) lattice happens to regenerate a point already chosen from
// a coarser pass. Independent loops accumulating spacing via `+=` are not
// guaranteed bit-identical even when mathematically aligned, so exact `===`
// is not safe here; this is far smaller than any realistic dock spacing.
const POINT_DEDUPE_EPS_DEG = 1e-7

export interface SuggestResult {
  docks: PlannedDock[]
  achievedPct: number
  stoppedBy: 'target' | 'cap' | 'gain' | 'exhausted'
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
  if (valid.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'exhausted' }

  const aoiGeom = valid
    .map((a) => feature(a.geometry))
    .reduce<Feature<Polygon | MultiPolygon> | null>(
      (acc, f) => (acc ? union(featureCollection([acc, f])) : f),
      null,
    )
  if (!aoiGeom) return { docks: [], achievedPct: 0, stoppedBy: 'exhausted' }
  // Rebind to a definitely-non-null const: TS control-flow narrowing on
  // `aoiGeom` does not carry into the nested function declarations below.
  const geom: Feature<Polygon | MultiPolygon> = aoiGeom

  const radiusKm = effectiveRadius(makeDock(0, 0, droneModel)).radiusKm
  const [minLon, minLat, maxLon, maxLat] = bbox(aoiGeom)
  const midLat = (minLat + maxLat) / 2

  // Hex lattice anchored to the bbox MINIMUM corner. Never a centroid or a
  // random origin: the anchor is what makes the whole thing reproducible.
  const initialSpacingKm = radiusKm * Math.sqrt(3) * (1 - plan.params.targetOverlapPct / 100)

  function buildLattice(spacingKm: number): [number, number][] {
    const dLat = spacingKm / KM_PER_DEG_LAT
    const dLon = spacingKm / kmPerDegLon(midLat)
    const list: [number, number][] = []
    let row = 0
    for (let lat = minLat; lat <= maxLat + dLat; lat += dLat, row += 1) {
      const offset = row % 2 === 0 ? 0 : dLon / 2 // hex stagger
      for (let lon = minLon + offset; lon <= maxLon + dLon; lon += dLon) {
        if (booleanPointInPolygon(point([lon, lat]), geom)) list.push([lon, lat])
      }
    }
    // Stable ordering: lat then lon ascending, so ties break identically.
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0])
    return list
  }

  // Candidate count scales with AOI area / radius^2 and is otherwise
  // unbounded; widen deterministically (same technique as the sample grid
  // below) until it fits under MAX_CANDIDATES, which keeps the greedy loop's
  // O(docks * candidates * samples) cost bounded on very large AOIs.
  function boundedLattice(spacingKm: number): { list: [number, number][]; spacingKm: number } {
    let s = spacingKm
    let list = buildLattice(s)
    while (list.length > MAX_CANDIDATES) {
      s *= CANDIDATE_SPACING_WIDEN_FACTOR
      list = buildLattice(s)
    }
    return { list, spacingKm: s }
  }

  const samePoint = (a: [number, number], b: [number, number]): boolean =>
    Math.abs(a[0] - b[0]) < POINT_DEDUPE_EPS_DEG && Math.abs(a[1] - b[1]) < POINT_DEDUPE_EPS_DEG

  let { list: candidates, spacingKm: currentCandidateSpacingKm } = boundedLattice(initialSpacingKm)

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
  if (samples.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'exhausted' }

  const covered = new Array<boolean>(samples.length).fill(false)
  const withinRadius = (c: [number, number], s: [number, number]): boolean => {
    const dy = (s[1] - c[1]) * KM_PER_DEG_LAT
    const dx = (s[0] - c[0]) * kmPerDegLon(midLat)
    return dx * dx + dy * dy <= radiusKm * radiusKm
  }

  const chosen: [number, number][] = []
  let stoppedBy: SuggestResult['stoppedBy'] = 'exhausted'
  let refinements = 0
  const total = samples.length

  // A candidate must cover at least this many still-uncovered sample cells
  // to be worth placing -- see MIN_MARGINAL_GAIN_SAMPLES' definition above
  // for why this is a plain cell count, not a percentage of anything.
  const minGainSamples = MIN_MARGINAL_GAIN_SAMPLES

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

    // The coarse lattice is exhausted but coverage is short of target and the
    // dock cap has not been hit: densify by halving spacing (bounded by
    // MAX_CANDIDATES, same as the initial lattice) and keep going, up to
    // MAX_REFINEMENTS times. Only once refinement itself cannot produce any
    // new site is the outcome genuinely 'exhausted'.
    if (candidates.length === 0) {
      if (refinements >= MAX_REFINEMENTS) {
        stoppedBy = 'exhausted'
        break
      }
      refinements += 1
      const rebuilt = boundedLattice(currentCandidateSpacingKm * REFINEMENT_SPACING_FACTOR)
      currentCandidateSpacingKm = rebuilt.spacingKm
      candidates = rebuilt.list.filter((c) => !chosen.some((ch) => samePoint(ch, c)))
      continue
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

    if (bestIdx < 0 || bestGain < minGainSamples) {
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
