import { describe, it, expect, beforeEach } from 'vitest'
import {
  suggestLayout,
  MAX_DOCKS,
  MIN_MARGINAL_GAIN_SAMPLES,
  SAMPLE_SPACING_DIVISOR,
  MAX_CANDIDATES,
  MAX_REFINEMENTS,
} from './autoPlace'
import { createPlan, addAoi, resetIdsForTest } from './plan'
import type { Aoi } from './types'

const squareAoi = (): Aoi => ({
  id: 'a1',
  name: 'BOX',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5015, 24.21],
        [54.6985, 24.21],
        [54.6985, 24.39],
        [54.5015, 24.39],
        [54.5015, 24.21],
      ],
    ],
  },
})

// A ~60km box (3x the linear extent of squareAoi), used to force the 40-dock
// cap: many small docks are needed to blanket it at a tight overlap setting.
const largeBoxAoi = (scale: number): Aoi => {
  const minLon = 54.5015
  const minLat = 24.21
  const maxLon = minLon + (54.6985 - 54.5015) * scale
  const maxLat = minLat + (24.39 - 24.21) * scale
  return {
    id: 'a1',
    name: 'LARGE BOX',
    source: 'drawn',
    valid: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
  }
}

const kmPerDegLonAt = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180)
const KM_PER_DEG_LAT = 111.2

// A thin north-south "needle" diamond: half-width 0.1km, half-height 1.25km,
// centered at (54.6, 24.3). Built from the same radius/spacing math
// suggestLayout itself uses (5km rural dock radius -> sample spacing
// radiusKm/SAMPLE_SPACING_DIVISOR = 1.25km), so this is a genuinely
// different fixture from tinyDiamondAoi below, not a smaller copy of it:
//
// - Its half-height (1.25km) is bit-identical to the sample grid's row
//   spacing, so the sample row exactly at the AOI's vertical center lands
//   exactly on the diamond's left vertex (a boundary point, which
//   booleanPointInPolygon treats as inside). That single sample point is
//   enough for `samples.length` to be 1, not 0 -- so suggestLayout passes
//   the pre-loop `samples.length === 0` guard and actually enters the greedy
//   loop, unlike tinyDiamondAoi, whose sample grid is empty and returns
//   'exhausted' before the loop ever runs.
// - Its half-width (0.1km) is far too narrow for any hex candidate site, at
//   the initial spacing or after any of the 3 refinements, to ever land
//   inside it: verified by temporarily instrumenting suggestLayout's
//   refinement branch (a console.error per refinement, listing
//   candidates.length before each) and confirming the trace is exactly
//   "empty -> refine #1 -> still empty -> refine #2 -> still empty ->
//   refine #3 -> still empty -> exhausted", i.e. all 3 refinements genuinely
//   run and genuinely fail to produce a site, in contrast to tinyDiamondAoi
//   where the same trace shows zero refinement log lines at all. The
//   instrumentation was removed once this was confirmed; it is not part of
//   the committed source.
const needleAoi = (): Aoi => {
  const cx = 54.6
  const cy = 24.3
  const wDeg = 0.1 / kmPerDegLonAt(cy)
  const hDeg = 1.25 / KM_PER_DEG_LAT
  return {
    id: 'a1',
    name: 'NEEDLE',
    source: 'drawn',
    valid: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [cx, cy + hDeg],
          [cx + wDeg, cy],
          [cx, cy - hDeg],
          [cx - wDeg, cy],
          [cx, cy + hDeg],
        ],
      ],
    },
  }
}

// Tiny diamond (~5m across), far smaller than any lattice spacing derived
// from a 5km dock radius, and its bbox min corner (the lattice's anchor) is
// itself the diamond's bottom vertex, i.e. outside its interior. No hex site
// at any spacing, coarse or refined, can ever land inside it.
const tinyDiamondAoi = (): Aoi => ({
  id: 'a1',
  name: 'TINY',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.6, 24.3],
        [54.60002, 24.30002],
        [54.6, 24.30004],
        [54.59998, 24.30002],
        [54.6, 24.3],
      ],
    ],
  },
})

describe('suggestLayout', () => {
  beforeEach(() => resetIdsForTest())

  it('exposes its tuning constants for tests to pin', () => {
    expect(MAX_DOCKS).toBe(40)
    // Defect 1 fix: the floor used to be MIN_MARGINAL_GAIN_PCT (0.25% of
    // *total AOI area*), which is not scale-invariant -- a rural dock's own
    // ~78.5km^2 footprint falls below that floor for any AOI over roughly
    // 31,400km^2, so the greedy loop rejected its very first candidate and
    // suggestLayout silently returned zero docks (see the "places docks on
    // a very large AOI" test below for the measured regression). A later
    // review found that the fraction-of-footprint framing that replaced it
    // was itself misleading -- see MIN_MARGINAL_GAIN_SAMPLES' definition in
    // autoPlace.ts -- so the floor is now a plain sample-cell count instead.
    expect(MIN_MARGINAL_GAIN_SAMPLES).toBe(2)
    expect(MAX_CANDIDATES).toBe(2000)
    expect(MAX_REFINEMENTS).toBe(3)
  })

  it('pins the dock-footprint-in-samples relationship that made the old fraction-of-footprint framing misleading', () => {
    // dockFootprintSamples = (pi * r^2) / (r / SAMPLE_SPACING_DIVISOR)^2
    //                      = pi * SAMPLE_SPACING_DIVISOR^2
    // The r cancels entirely, so a dock's own footprint, measured in sample
    // cells, is a near-constant ~50.3 regardless of AOI size or dock radius
    // -- it depends only on SAMPLE_SPACING_DIVISOR. This is exactly why the
    // gain floor is now named directly in sample cells (MIN_MARGINAL_GAIN_
    // SAMPLES) instead of as a fraction of footprint: the fraction added no
    // real scale-sensitivity beyond what this constant already fixes. If
    // SAMPLE_SPACING_DIVISOR ever changes, this test fails, forcing a
    // conscious check of what MIN_MARGINAL_GAIN_SAMPLES now means in km^2.
    expect(SAMPLE_SPACING_DIVISOR).toBe(4)
    for (const r of [1, 5, 12.87, 200]) {
      const dockFootprintSamples = (Math.PI * r * r) / (r / SAMPLE_SPACING_DIVISOR) ** 2
      expect(dockFootprintSamples).toBeCloseTo(Math.PI * SAMPLE_SPACING_DIVISOR ** 2, 9)
      expect(dockFootprintSamples).toBeCloseTo(50.265, 3)
    }
  })

  it('pins the real-world ground area MIN_MARGINAL_GAIN_SAMPLES corresponds to at the rural radius, pre-widening', () => {
    // Sample spacing is radiusKm / SAMPLE_SPACING_DIVISOR, so each sample
    // cell's area is that spacing squared. For the 5km rural radius, before
    // any MAX_SAMPLE_POINTS-driven widening, that is (5/4)^2 = 1.5625km^2 per
    // cell, so MIN_MARGINAL_GAIN_SAMPLES=2 floors a candidate's minimum
    // useful marginal gain at roughly 3.125km^2 of newly covered ground at
    // this resolution. A change to SAMPLE_SPACING_DIVISOR changes this real
    // area even though MIN_MARGINAL_GAIN_SAMPLES itself would not move --
    // this test exists so that change is caught, not silent.
    const ruralRadiusKm = 5
    const sampleSpacingKm = ruralRadiusKm / SAMPLE_SPACING_DIVISOR
    expect(sampleSpacingKm).toBe(1.25)
    const cellAreaKm2 = sampleSpacingKm * sampleSpacingKm
    expect(cellAreaKm2).toBeCloseTo(1.5625, 6)
    expect(MIN_MARGINAL_GAIN_SAMPLES * cellAreaKm2).toBeCloseTo(3.125, 6)
  })

  it('returns no docks when there is no AOI', () => {
    const r = suggestLayout(createPlan())
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
    expect(r.stoppedBy).toBe('exhausted')
  })

  it('covers a 20km box to the required percentage', () => {
    const plan = addAoi(createPlan(), squareAoi())
    const r = suggestLayout(plan)
    expect(r.docks.length).toBeGreaterThan(0)
    expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
    expect(r.achievedPct).toBeGreaterThan(80)
  })

  it('marks every suggested dock with source auto', () => {
    const r = suggestLayout(addAoi(createPlan(), squareAoi()))
    expect(r.docks.every((d) => d.source === 'auto')).toBe(true)
  })

  it('is deterministic: identical input gives byte-identical output', () => {
    const plan = addAoi(createPlan(), squareAoi())
    resetIdsForTest()
    const a = suggestLayout(plan)
    resetIdsForTest()
    const b = suggestLayout(plan)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('reaches the default required coverage by densifying past the initial lattice', () => {
    // The initial (unrefined) hex lattice over this box yields exactly 9
    // in-AOI candidate sites. Before the densify fix, the greedy loop
    // stopped the moment those 9 ran out, at ~88.45% coverage, and
    // mislabeled it as stoppedBy: 'gain' even though the 9th dock's
    // marginal gain (1.838%) was well above the 0.25% floor. With
    // refinement, the loop keeps densifying (bounded by MAX_REFINEMENTS)
    // until it actually reaches the required coverage.
    const plan = addAoi(createPlan(), squareAoi())
    const r = suggestLayout(plan)
    expect(r.stoppedBy).toBe('target')
    expect(r.achievedPct).toBeGreaterThanOrEqual(plan.params.requiredCoveragePct)
    // Reaching target needed more docks than the 9 the coarse lattice alone
    // could offer, proving refinement actually ran.
    expect(r.docks.length).toBeGreaterThan(9)
  })

  it('refinement itself is deterministic: two runs on the same input match byte-for-byte', () => {
    const plan = addAoi(createPlan(), squareAoi())
    resetIdsForTest()
    const a = suggestLayout(plan)
    resetIdsForTest()
    const b = suggestLayout(plan)
    // Sanity: this scenario actually exercises refinement (see the test
    // above), so this is pinning refined output, not just the coarse pass.
    expect(a.docks.length).toBeGreaterThan(9)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('respects the dock cap and reports it honestly as cap, not gain', () => {
    // A ~60km box at a tight (20%) overlap needs far more than 40 docks to
    // fully blanket, so the cap is the genuine, unambiguous stopping reason.
    const plan = addAoi(createPlan(), largeBoxAoi(3))
    const tight = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 90 } }
    const r = suggestLayout(tight)
    expect(r.stoppedBy).toBe('cap')
    expect(r.docks.length).toBe(MAX_DOCKS)
    expect(r.achievedPct).toBeLessThan(90)
  })

  it('places docks on a ~200km-wide AOI instead of refusing the first candidate (Defect 1 regression)', () => {
    // A few-hundred-km AOI at a 5km dock radius -- under the OLD
    // percent-of-total-area floor (MIN_MARGINAL_GAIN_PCT = 0.25% of total
    // AOI area), even the single best candidate site's entire footprint
    // covered under 0.25% of this AOI's area, so the greedy loop refused the
    // very first candidate and returned zero docks with stoppedBy: 'gain'
    // (this was Finding 2's exact scenario). With the floor now a fixed
    // sample-cell count instead of a fraction of total area, the
    // first candidate's near-full-footprint gain clears it easily, and the
    // loop places docks all the way up to MAX_DOCKS -- this AOI needs far
    // more than 40 docks to blanket at a tight 20% overlap, so the cap is
    // the genuine, unambiguous stopping reason, not silence.
    const plan = addAoi(createPlan(), largeBoxAoi(10))
    const params = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 95 } }
    const start = Date.now()
    const r = suggestLayout(params)
    const elapsedMs = Date.now() - start
    expect(r.stoppedBy).toBe('cap')
    expect(r.docks.length).toBe(MAX_DOCKS)
    expect(r.achievedPct).toBeGreaterThan(0)
    expect(r.achievedPct).toBeLessThan(95)
    // MAX_CANDIDATES keeps the lattice (and so this run) bounded even though
    // the AOI is hundreds of km across; this must stay interactive.
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('places docks on a >50,000km2 AOI that used to return zero under the old area-relative floor (Defect 1 regression)', () => {
    // The measured failure this task started from: drawing an AOI this
    // large and clicking SUGGEST LAYOUT produced zero docks and no
    // explanation at all. largeBoxAoi(14.36) is ~82,500km^2 (scale^2 *
    // squareAoi's ~400km^2), comfortably past the ~31,400km^2 point where a
    // single 5km-radius dock's whole footprint already falls under the old
    // 0.25%-of-total-area floor. Default plan params (20% overlap, 95%
    // required coverage, see DEFAULT_PARAMS in domain/plan.ts) are used
    // deliberately -- no tight/adversarial tuning -- because the live bug
    // report reproduced with an ordinary drawn AOI and default parameters.
    const plan = addAoi(createPlan(), largeBoxAoi(14.36))
    const start = Date.now()
    const r = suggestLayout(plan)
    const elapsedMs = Date.now() - start
    expect(r.docks.length).toBeGreaterThan(0)
    expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
    // At this scale, MAX_DOCKS worth of 5km-radius docks cannot come close
    // to fully blanketing ~82,500km^2, so hitting the dock cap -- not a
    // silent 'gain'/'exhausted' -- is the honest, expected outcome.
    expect(r.stoppedBy).toBe('cap')
    expect(r.docks.length).toBe(MAX_DOCKS)
    expect(r.achievedPct).toBeGreaterThan(0)
    // Generous ceiling matching the other large-AOI perf assertions in this
    // file; this only needs to catch a genuine blowup, not pin exact timing.
    expect(elapsedMs).toBeLessThan(8000)
  })

  it('still stops on a genuinely negligible marginal gain, not silence, once coverage is nearly total', () => {
    // A real 'gain' scenario under the new, scale-invariant floor: pushing
    // the 20km box to a near-total 99.9% target with a loose 50% overlap
    // means the last docks the coarse lattice can offer each add only a
    // sliver of new ground -- genuinely under MIN_MARGINAL_GAIN_SAMPLES (2)
    // sample cells of newly covered ground -- while candidates remain on
    // the table and the cap is nowhere close. This is the same
    // honest-labelling contract as before (see the design doc section 8):
    // 'gain' still means "the next dock was not worth it", it is just no
    // longer confused with "this AOI is too big for the floor to ever clear".
    const plan = addAoi(createPlan(), squareAoi())
    const params = { ...plan, params: { targetOverlapPct: 50, requiredCoveragePct: 99.9 } }
    const r = suggestLayout(params)
    expect(r.stoppedBy).toBe('gain')
    expect(r.docks.length).toBeGreaterThan(0)
    expect(r.docks.length).toBeLessThan(MAX_DOCKS)
    expect(r.achievedPct).toBeGreaterThan(90)
    expect(r.achievedPct).toBeLessThan(99.9)
  })

  it('reports exhausted when the sample grid itself is empty (pre-loop guard)', () => {
    // tinyDiamondAoi is smaller than the sample spacing itself, so
    // `samples.length === 0` and suggestLayout returns 'exhausted' from the
    // pre-loop guard without ever entering the greedy loop or the
    // refinement branch. See needleAoi below for a fixture that actually
    // exercises refinement.
    const plan = addAoi(createPlan(), tinyDiamondAoi())
    const r = suggestLayout(plan)
    expect(r.stoppedBy).toBe('exhausted')
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
  })

  it('reports exhausted when refinement itself runs and still cannot produce a site', () => {
    // Unlike tinyDiamondAoi, needleAoi has a non-empty sample grid (see its
    // definition above), so this genuinely enters the greedy loop. Its
    // candidate lattice is empty at the initial spacing and stays empty
    // through all 3 refinements (confirmed via temporary instrumentation,
    // now removed -- see the comment on needleAoi), so this exercises the
    // real "densify up to MAX_REFINEMENTS times, still nothing, report
    // exhausted" path rather than short-circuiting before the loop starts.
    const plan = addAoi(createPlan(), needleAoi())
    const r = suggestLayout(plan)
    expect(r.stoppedBy).toBe('exhausted')
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
  })

  it.each([16, 25])(
    'widens the candidate lattice under MAX_CANDIDATES for a scale-%i box',
    (scale) => {
      // Verified independently (bbox/booleanPointInPolygon replica of
      // boundedLattice, not part of this test) that the raw, unwidened hex
      // lattice for these AOIs is far above MAX_CANDIDATES: scale 16 yields
      // ~2162 raw candidates, widened to ~946 in a single pass; scale 25
      // yields ~5183, widened to ~1040 in two passes. The existing 'cap' and
      // 'gain' fixtures (scale 3 and scale 10) only ever produce 81 and 841
      // raw candidates, so neither exercises boundedLattice's while loop at
      // all. This is large enough to force it on every run.
      const plan = addAoi(createPlan(), largeBoxAoi(scale))
      const params = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 95 } }
      const start = Date.now()
      const r = suggestLayout(params)
      const elapsedMs = Date.now() - start

      // Under the OLD area-relative floor, a single 5km-radius dock covered
      // a negligible fraction of this much total AOI area, so the very
      // first candidate's marginal gain was below the floor and the loop
      // refused to place anything at all (stoppedBy: 'gain', zero docks --
      // the same silent-failure shape as the scale-10 fixture above). With
      // the floor now relative to one dock's own footprint, the first
      // candidate clears it easily and the loop places docks up to the cap
      // instead. The point of this test is not that outcome specifically
      // but that reaching it still respects the dock cap and stays fast,
      // proving the widened (not raw) candidate lattice was what actually
      // got evaluated even at this scale.
      expect(r.stoppedBy).toBe('cap')
      expect(r.docks.length).toBe(MAX_DOCKS)
      expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
      expect(r.achievedPct).toBeGreaterThan(0)
      // Generous ceiling: real runs complete in well under it. This only
      // needs to catch a genuine blowup (e.g. the widen loop failing to
      // converge), not pin exact performance.
      expect(elapsedMs).toBeLessThan(8000)
    },
  )
})
