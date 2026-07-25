import { describe, it, expect, afterEach } from 'vitest'
import {
  createPlan,
  addDock,
  updateDock,
  removeDock,
  setDocks,
  setParams,
  resetIdsForTest,
  setNowForTest,
  resetNowForTest,
} from './plan'
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

  describe('determinism with pinned clock and ids', () => {
    afterEach(() => {
      resetNowForTest()
      resetIdsForTest()
    })

    it('produces byte-identical output for the same mutation sequence', () => {
      const run = (): ReturnType<typeof addDock> => {
        resetIdsForTest()
        setNowForTest(() => '2026-01-01T00:00:00.000Z')
        const p0 = createPlan({ name: 'Reproducible' })
        const p1 = addDock(p0, dock('d1'))
        const p2 = addDock(p1, dock('d2'))
        return updateDock(p2, 'd1', { radiusKmOverride: 3 })
      }

      const resultA = run()
      const resultB = run()

      expect(resultA).toEqual(resultB)
      expect(resultA.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    })
  })

  describe('setDocks / setParams defensive copies', () => {
    it('setDocks does not alias the caller array', () => {
      const p0 = createPlan()
      const docks = [dock('d1')]
      const p1 = setDocks(p0, docks)

      docks.push(dock('d2'))

      expect(p1.docks).toHaveLength(1)
      expect(p1.docks[0].id).toBe('d1')
    })

    it('setParams does not alias the caller object', () => {
      const p0 = createPlan()
      const params = { targetOverlapPct: 10, requiredCoveragePct: 90 }
      const p1 = setParams(p0, params)

      params.targetOverlapPct = 999

      expect(p1.params.targetOverlapPct).toBe(10)
    })
  })
})
