import { describe, it, expect } from 'vitest'
import { buildPlannerStyle, aoiFeatures, dockFeatures, PLANNER_SOURCES } from './plannerStyle'
import { createPlan, addAoi, addDock } from '../domain/plan'
import type { Aoi, PlannedDock } from '../domain/types'

const aoi: Aoi = {
  id: 'a1',
  name: 'BOX',
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
const dock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
}

describe('buildPlannerStyle', () => {
  it('includes every planner source and no console sim sources', () => {
    const style = buildPlannerStyle()
    for (const id of Object.values(PLANNER_SOURCES)) {
      expect(style.sources[id]).toBeDefined()
    }
    // The planner has no simulation, so it must not inherit these.
    expect(style.sources['drones']).toBeUndefined()
    expect(style.sources['tracks']).toBeUndefined()
    expect(style.sources['wizard-preview']).toBeUndefined()
  })
})

describe('feature builders', () => {
  it('builds one polygon feature per valid AOI', () => {
    const fc = aoiFeatures(addAoi(createPlan(), aoi))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.id).toBe('a1')
  })

  it('builds one point feature per dock carrying its source for styling', () => {
    const fc = dockFeatures(addDock(createPlan(), dock))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.source).toBe('manual')
  })
})
