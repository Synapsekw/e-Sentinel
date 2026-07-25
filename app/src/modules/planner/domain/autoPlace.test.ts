import { describe, it, expect, beforeEach } from 'vitest'
import {
  suggestLayout,
  MAX_DOCKS,
  MIN_MARGINAL_GAIN_PCT,
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
    expect(MIN_MARGINAL_GAIN_PCT).toBe(0.25)
    expect(MAX_CANDIDATES).toBe(2000)
    expect(MAX_REFINEMENTS).toBe(3)
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

  it('stops on gain only when the best remaining candidate truly is not worth it', () => {
    // A few-hundred-km AOI at a 5km dock radius (the scenario Finding 2 is
    // about): even the single best candidate site covers under 0.25% of the
    // total AOI area, so the greedy loop should refuse the very first dock.
    // This is a real, plentiful candidate lattice (hundreds of in-AOI hex
    // sites at this spacing) scoring below the floor, not an empty one, so
    // it must report 'gain' and never 'exhausted'.
    const plan = addAoi(createPlan(), largeBoxAoi(10))
    const params = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 95 } }
    const start = Date.now()
    const r = suggestLayout(params)
    const elapsedMs = Date.now() - start
    expect(r.stoppedBy).toBe('gain')
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
    // MAX_CANDIDATES keeps the lattice (and so this run) bounded even though
    // the AOI is hundreds of km across; this must stay interactive.
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('reports exhausted when refinement genuinely cannot produce another candidate site', () => {
    const plan = addAoi(createPlan(), tinyDiamondAoi())
    const r = suggestLayout(plan)
    expect(r.stoppedBy).toBe('exhausted')
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
  })
})
