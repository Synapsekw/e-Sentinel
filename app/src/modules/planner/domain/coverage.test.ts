import { describe, it, expect } from 'vitest'
import { computeCoverage } from './coverage'
import { createPlan, addAoi, addDock } from './plan'
import type { Aoi, PlannedDock } from './types'

// A ~20km x 20km box near Abu Dhabi. At 24.3 degrees latitude, 1 degree of
// latitude is ~111.2km and 1 degree of longitude is ~101.4km, so 0.18 lat by
// 0.197 lon is close enough to 20km x 20km for a +/-2% assertion.
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

const dockAt = (id: string, lon: number, lat: number): PlannedDock => ({
  id,
  name: id,
  position: [lon, lat],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural', // rural => 5km cap, so radius is exactly 5km
  source: 'manual',
})

describe('computeCoverage', () => {
  it('reports no-aoi before any AOI exists', () => {
    const r = computeCoverage(addDock(createPlan(), dockAt('d1', 54.6, 24.3)))
    expect(r).toEqual({ ok: false, reason: 'no-aoi' })
  })

  it('reports no-docks when an AOI exists but no docks do', () => {
    const r = computeCoverage(addAoi(createPlan(), squareAoi()))
    expect(r).toEqual({ ok: false, reason: 'no-docks' })
  })

  it('computes coverage for one centred 5km dock as pi*r^2 over the AOI', () => {
    // circle = pi * 5^2 = 78.54 km^2; AOI = 400 km^2 => 19.6%
    const plan = addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.aoiKm2).toBeCloseTo(400, -1) // within ~10 km^2
    expect(r.coveragePct).toBeGreaterThan(17.6)
    expect(r.coveragePct).toBeLessThan(21.6)
    expect(r.overlapPct).toBe(0)
    expect(r.gapCount).toBe(1)
  })

  it('computes overlap for two 5km docks 5km apart from the lens-area formula', () => {
    // Lens area for r=5, d=5:
    //   2r^2*acos(d/2r) - (d/2)*sqrt(4r^2 - d^2)
    // = 50*acos(0.5) - 2.5*sqrt(75) = 52.36 - 21.65 = 30.71 km^2
    // covered = 2*78.54 - 30.71 = 126.37 km^2
    // overlap = 30.71 / 126.37 = 24.3%
    const dLon = 5 / 101.4 // 5km east at this latitude
    const plan = addDock(
      addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6 - dLon / 2, 24.3)),
      dockAt('d2', 54.6 + dLon / 2, 24.3),
    )
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.overlapPct).toBeGreaterThan(22.3)
    expect(r.overlapPct).toBeLessThan(26.3)
  })

  it('excludes AOIs flagged invalid from the math', () => {
    const bad: Aoi = { ...squareAoi(), id: 'a2', valid: false }
    const plan = addAoi(addAoi(createPlan(), squareAoi()), bad)
    const withDock = addDock(plan, dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(withDock)
    if (!r.ok) throw new Error('expected ok')
    expect(r.aoiKm2).toBeCloseTo(400, -1) // not 800
  })

  it('attributes per-dock contribution area', () => {
    const plan = addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.perDock).toHaveLength(1)
    expect(r.perDock[0].dockId).toBe('d1')
    expect(r.perDock[0].contributionKm2).toBeCloseTo(78.5, 0)
  })
})
