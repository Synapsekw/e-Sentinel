import { describe, it, expect } from 'vitest'
import { effectiveRadius, radiusFromTerms, DRONES } from './catalog'
import type { PlannedDock } from './types'

const dock = (patch: Partial<PlannedDock> = {}): PlannedDock => ({
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
  ...patch,
})

describe('effectiveRadius', () => {
  it('derives endurance range from cruise, endurance, reserve and on-task time', () => {
    // M4TD: 54 kph, 48 min, 30% reserve, 5 min on task
    // usable = 48 * 0.7 = 33.6; out-leg = (33.6 - 5) / 2 = 14.3 min
    // km = 54/60 * 14.3 = 12.87
    const r = effectiveRadius(dock())
    expect(r.enduranceKm).toBeCloseTo(12.87, 2)
  })

  it('lets the environment cap bind when it is smaller (urban 3km)', () => {
    const r = effectiveRadius(dock({ environment: 'urban' }))
    expect(r.capKm).toBe(3)
    expect(r.radiusKm).toBe(3)
    expect(r.bound).toBe('cap')
  })

  it('uses the rural cap of 5km for rural docks', () => {
    const r = effectiveRadius(dock({ environment: 'rural' }))
    expect(r.capKm).toBe(5)
    expect(r.radiusKm).toBe(5)
    expect(r.bound).toBe('cap')
  })

  it('lets a per-dock override win over both', () => {
    const r = effectiveRadius(dock({ radiusKmOverride: 8 }))
    expect(r.radiusKm).toBe(8)
    expect(r.bound).toBe('override')
    // The derivation is still reported so the inspector can show the headroom.
    expect(r.enduranceKm).toBeCloseTo(12.87, 2)
    expect(r.capKm).toBe(3)
  })

  it('reports endurance as binding when endurance is below the cap', () => {
    // No catalogued airframe is endurance-bound (all three exceed both the 3km
    // and 5km caps), so this branch is exercised through the exported pure
    // helper rather than a catalog entry. Testing it matters: if real datasheet
    // figures land lower than these provisional ones, this becomes the live
    // branch and it must already be correct.
    const r = radiusFromTerms({ enduranceKm: 2, capKm: 5, override: undefined })
    expect(r.radiusKm).toBe(2)
    expect(r.bound).toBe('endurance')
  })

  it('every catalogued drone carries all four derivation terms', () => {
    for (const spec of Object.values(DRONES)) {
      expect(spec.cruiseKph).toBeGreaterThan(0)
      expect(spec.enduranceMin).toBeGreaterThan(0)
      expect(spec.reservePct).toBeGreaterThan(0)
      expect(spec.onTaskMin).toBeGreaterThanOrEqual(0)
    }
  })
})
