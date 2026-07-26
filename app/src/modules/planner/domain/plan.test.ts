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
  nextId,
  adoptIdsFrom,
  nextDockName,
  nextAoiName,
  uniqueName,
} from './plan'
import type { Aoi, DeploymentPlan, PlannedDock } from './types'

const dock = (id: string): PlannedDock => ({
  id,
  name: id,
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
})

const aoi = (id: string): Aoi => ({
  id,
  name: id,
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.2],
        [54.7, 24.4],
        [54.5, 24.4],
        [54.5, 24.2],
      ],
    ],
  },
})

// Deliberately does not call createPlan(): that itself calls nextId('plan'),
// which would perturb the very counter these tests are pinning down. This
// builds a fixture plan shape without touching seq.
const planWith = (aois: Aoi[], docks: PlannedDock[]): DeploymentPlan => ({
  id: 'fixture-plan',
  name: 'FIXTURE',
  customer: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
  aois,
  docks,
  params: { targetOverlapPct: 20, requiredCoveragePct: 95 },
  rev: 0,
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

  describe('adoptIdsFrom', () => {
    afterEach(() => {
      resetIdsForTest()
    })

    it('advances the counter past ids restored from a prior session, so newly minted ids never collide', () => {
      resetIdsForTest()
      const restored = planWith([aoi('aoi-1'), aoi('aoi-2')], [dock('dock-1')])

      adoptIdsFrom(restored)
      const minted = [nextId('aoi'), nextId('aoi'), nextId('dock')]

      const restoredIds = new Set([
        ...restored.aois.map((a) => a.id),
        ...restored.docks.map((d) => d.id),
      ])
      for (const id of minted) expect(restoredIds.has(id)).toBe(false)
    })

    it('ignores ids it cannot parse instead of throwing, while still protecting the parseable ones', () => {
      resetIdsForTest()
      const plan = planWith([aoi('custom-abc'), aoi(''), aoi('aoi-'), aoi('aoi-3')], [])

      expect(() => adoptIdsFrom(plan)).not.toThrow()
      const minted = nextId('aoi')
      expect(minted).toBe('aoi-4')
    })

    it('never moves the counter backwards', () => {
      resetIdsForTest()
      nextId('aoi') // seq -> 1
      nextId('aoi') // seq -> 2
      nextId('aoi') // seq -> 3, so the next mint would be aoi-4

      adoptIdsFrom(planWith([aoi('aoi-1')], []))

      expect(nextId('aoi')).toBe('aoi-4')
    })

    it('regression: restoring a plan containing aoi-2 and then drawing a new AOI must not reissue aoi-2', () => {
      resetIdsForTest()
      const restored = planWith([aoi('aoi-1'), aoi('aoi-2')], [])

      adoptIdsFrom(restored)
      const minted = nextId('aoi')

      expect(minted).not.toBe('aoi-2')
    })
  })
})

function dockNamed(id: string, name: string): PlannedDock {
  return {
    id,
    name,
    position: [54.6, 24.3],
    dockModel: 'DOCK3',
    droneModel: 'M4TD',
    environment: 'rural',
    source: 'manual',
  }
}

function aoiNamed(id: string, name: string): Aoi {
  return {
    id,
    name,
    source: 'drawn',
    valid: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.7, 24.4],
          [54.5, 24.2],
        ],
      ],
    },
  }
}

describe('nextDockName', () => {
  it('starts at DOCK 01 on an empty plan', () => {
    expect(nextDockName({ docks: [] })).toBe('DOCK 01')
  })

  it('zero-pads to two digits', () => {
    expect(nextDockName({ docks: [dockNamed('d1', 'DOCK 01')] })).toBe('DOCK 02')
  })

  it('numbers from the highest existing number, not the array length', () => {
    // The bug: length+1 after a removal collides. DOCK 01 + DOCK 03 is length
    // 2, so length+1 would mint a second DOCK 03.
    const docks = [dockNamed('d1', 'DOCK 01'), dockNamed('d3', 'DOCK 03')]
    expect(nextDockName({ docks })).toBe('DOCK 04')
  })

  it('ignores renamed docks that do not match the pattern', () => {
    const docks = [dockNamed('d1', 'JEBEL ALI NORTH'), dockNamed('d2', 'DOCK 07')]
    expect(nextDockName({ docks })).toBe('DOCK 08')
  })

  it('does not zero-pad past two digits', () => {
    expect(nextDockName({ docks: [dockNamed('d1', 'DOCK 99')] })).toBe('DOCK 100')
  })
})

describe('nextAoiName', () => {
  it('starts at AOI 1', () => {
    expect(nextAoiName({ aois: [] })).toBe('AOI 1')
  })

  it('numbers from the highest existing number, not the array length', () => {
    const aois = [aoiNamed('a1', 'AOI 1'), aoiNamed('a3', 'AOI 3')]
    expect(nextAoiName({ aois })).toBe('AOI 4')
  })

  it('ignores imported names that do not match the pattern', () => {
    expect(nextAoiName({ aois: [aoiNamed('a1', 'AOI ONE')] })).toBe('AOI 1')
  })
})

describe('uniqueName', () => {
  it('leaves a name that collides with nothing untouched', () => {
    expect(uniqueName('AOI ONE', ['AOI TWO'])).toBe('AOI ONE')
  })

  it('suffixes a collision', () => {
    expect(uniqueName('AOI ONE', ['AOI ONE'])).toBe('AOI ONE (2)')
  })

  it('keeps counting past an existing suffix', () => {
    expect(uniqueName('AOI ONE', ['AOI ONE', 'AOI ONE (2)'])).toBe('AOI ONE (3)')
  })

  it('handles an empty taken list', () => {
    expect(uniqueName('IMPORTED AREA', [])).toBe('IMPORTED AREA')
  })
})
