import { describe, it, expect } from 'vitest'
import { createPlan, addDock, updateDock, removeDock } from './plan'
import type { PlannedDock } from './types'

const dock = (id: string): PlannedDock => ({
  id,
  name: id,
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
})

describe('plan mutations', () => {
  it('creates an empty plan at rev 0', () => {
    const p = createPlan()
    expect(p.aois).toEqual([])
    expect(p.docks).toEqual([])
    expect(p.rev).toBe(0)
    expect(p.schemaVersion).toBe(1)
  })

  it('bumps rev on every mutation', () => {
    const p0 = createPlan()
    const p1 = addDock(p0, dock('d1'))
    const p2 = addDock(p1, dock('d2'))
    expect(p1.rev).toBe(1)
    expect(p2.rev).toBe(2)
    expect(p2.docks).toHaveLength(2)
  })

  it('does not mutate the input plan', () => {
    const p0 = createPlan()
    addDock(p0, dock('d1'))
    expect(p0.docks).toHaveLength(0)
    expect(p0.rev).toBe(0)
  })

  it('patches a dock without touching its neighbours', () => {
    const p = addDock(addDock(createPlan(), dock('d1')), dock('d2'))
    const out = updateDock(p, 'd1', { radiusKmOverride: 7 })
    expect(out.docks[0].radiusKmOverride).toBe(7)
    expect(out.docks[1].radiusKmOverride).toBeUndefined()
  })

  it('removes a dock by id', () => {
    const p = addDock(addDock(createPlan(), dock('d1')), dock('d2'))
    expect(removeDock(p, 'd1').docks.map((d) => d.id)).toEqual(['d2'])
  })
})
