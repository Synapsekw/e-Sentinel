import { describe, it, expect, vi, afterEach } from 'vitest'
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
    expect(r.perDock[0].grossContributionKm2).toBeCloseTo(78.5, 0)
  })

  it('sums grossContributionKm2 to more than the actual covered area when docks overlap', () => {
    // Same two-dock, 5km-apart setup as the overlap test above. Each dock
    // reports its own ~78.54 km^2 buffer-in-AOI on its own, so the two
    // per-dock numbers sum to ~157.1 km^2, while the real covered area
    // (coveragePct * aoiKm2 / 100) is only ~126.37 km^2: the shared lens is
    // counted once per dock. grossContributionKm2 is gross by design and must
    // never be summed or shown as a share of coveragePct; this test pins that
    // semantic so a later reader cannot mistake it for an additive quantity.
    const dLon = 5 / 101.4
    const plan = addDock(
      addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6 - dLon / 2, 24.3)),
      dockAt('d2', 54.6 + dLon / 2, 24.3),
    )
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    const grossSum = r.perDock.reduce((sum, d) => sum + d.grossContributionKm2, 0)
    const actualCoveredKm2 = (r.coveragePct / 100) * r.aoiKm2
    expect(grossSum).toBeGreaterThan(actualCoveredKm2)
  })

  it('converts a thrown turf error into a degenerate result instead of propagating', () => {
    // Imported KML can carry NaN coordinates. With a single AOI, unionAll
    // returns it untouched and area() quietly returns null (already handled
    // by the null-guards). But with two AOIs, unionAll calls turf's union(),
    // which does not return null for this input, it throws
    // "Tried to create degenerate segment at [...]" (confirmed by running
    // this exact union() call standalone before adding the try/catch, and by
    // temporarily removing coverage.ts's try/catch and observing this test
    // fail with that raw error instead of the expected degenerate result).
    const nanAoi: Aoi = {
      id: 'a-nan',
      name: 'BAD KML IMPORT',
      source: 'kml',
      valid: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [54.5, 24.2],
            [NaN, 24.2],
            [54.6, 24.3],
            [54.5, 24.2],
          ],
        ],
      },
    }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plan = addDock(
      addAoi(addAoi(createPlan(), squareAoi()), nanAoi),
      dockAt('d1', 54.6, 24.3),
    )
    const r = computeCoverage(plan)
    expect(r).toEqual({ ok: false, reason: 'degenerate' })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
