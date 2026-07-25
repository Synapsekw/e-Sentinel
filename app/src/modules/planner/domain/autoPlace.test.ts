import { describe, it, expect, beforeEach } from 'vitest'
import { suggestLayout, MAX_DOCKS, MIN_MARGINAL_GAIN_PCT } from './autoPlace'
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

describe('suggestLayout', () => {
  beforeEach(() => resetIdsForTest())

  it('exposes its tuning constants for tests to pin', () => {
    expect(MAX_DOCKS).toBe(40)
    expect(MIN_MARGINAL_GAIN_PCT).toBe(0.25)
  })

  it('returns no docks when there is no AOI', () => {
    const r = suggestLayout(createPlan())
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
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

  it('respects the dock cap and reports why it stopped', () => {
    const plan = addAoi(createPlan(), squareAoi())
    const tight = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 100 } }
    const r = suggestLayout(tight)
    expect(['target', 'cap', 'gain']).toContain(r.stoppedBy)
    expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
  })
})
