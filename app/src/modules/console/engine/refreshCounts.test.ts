import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { computeCounts } from './refreshCounts'

describe('computeCounts', () => {
  it('counts ready/charging/alert docks and airborne drones from live engine state', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 400; i++) e.tick(0.5)
    const c = computeCounts(e)
    let ready = 0,
      airborne = 0
    for (const d of e.docks.values()) if (d.state === 'ready') ready++
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    expect(c.ready).toBe(ready)
    expect(c.flying).toBe(airborne)
    expect(c.ready + c.flying).toBeLessThanOrEqual(e.docks.size + e.drones.size)
  })
})
