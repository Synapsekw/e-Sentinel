import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { buildDockFeatures, buildDroneFeatures, spotlitMissionId } from './liveFeatures'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5) // fly the sim ~200s so drones launch
  return e
}

describe('live feature builders', () => {
  it('buildDockFeatures emits one point per dock with live state', () => {
    const e = bootedEngine()
    const fc = buildDockFeatures(e, null)
    expect(fc.features.length).toBe(e.docks.size)
    expect(fc.features[0].properties?.selected).toBe(false)
  })
  it('buildDroneFeatures emits only airborne drones with finite positions', () => {
    const e = bootedEngine()
    const fc = buildDroneFeatures(e)
    let airborne = 0
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    expect(fc.features.length).toBe(airborne)
    expect(
      fc.features.every((f) =>
        Number.isFinite((f.geometry as { coordinates: number[] }).coordinates[0]),
      ),
    ).toBe(true)
  })
  it("spotlitMissionId returns the selected drone's mission, or null with no selection", () => {
    const e = bootedEngine()
    expect(spotlitMissionId(e, null, null)).toBe(null)
    const flying = [...e.drones.values()].find((d) => d.missionId)
    if (flying)
      expect(spotlitMissionId(e, { type: 'drone', id: flying.id }, null)).toBe(flying.missionId)
  })
})
