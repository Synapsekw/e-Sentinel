// Ported (Phase 1E / Task 2) — test contract given verbatim by
// docs/superpowers/plans/2026-07-25-phase1e-control-wizard-debrief.md's
// Task 2 / Step 1.

import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { waypointFeatures, manualBannerText } from './manualModel'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
}

describe('manual control model', () => {
  it('banner copy matches control.js:40', () => {
    expect(manualBannerText('D-AUH-001')).toBe(
      'MANUAL CONTROL · D-AUH-001 · CLICK TO FLY · SHIFT+CLICK TO QUEUE',
    )
  })
  it('waypointFeatures is empty without an engine or an active drone', () => {
    expect(waypointFeatures(null, 'D-AUH-001').features).toEqual([])
    const e = bootedEngine()
    expect(waypointFeatures(e, null).features).toEqual([])
  })
  it('numbers each queued waypoint from 1', () => {
    const e = bootedEngine()
    const drone = [...e.drones.values()].find((d) => ['transit', 'on-task'].includes(d.state))
    expect(drone).toBeTruthy()
    expect(e.setManual(drone!.id, true)).toBe(true)
    e.manualQueue(drone!.id, [55.2, 25.1])
    e.manualQueue(drone!.id, [55.3, 25.2])
    const fc = waypointFeatures(e, drone!.id)
    expect(fc.features.length).toBe(2)
    expect(fc.features.map((f) => f.properties?.n)).toEqual([1, 2])
    // DEVIATION from the plan's Step 1 listing: the plan asserted the first
    // feature's geometry against the raw clicked coordinate ([55.2, 25.1]
    // verbatim). engine.manualQueue (domain/engine.ts's manualTarget, not
    // this file) clamps every queued point into the drone's home dock's
    // coverage ring (control.js/panels.js's same pullToRange contract used
    // by manual goto/queue) — [55.2, 25.1] is ~130km from AUH-008's dock
    // (the drone this fixture actually lands on after 800 ticks, dock
    // range 5km), so the engine clamps it before waypointFeatures ever
    // sees it. waypointFeatures is a pure passthrough over
    // drone._manualQueue (control.js:88-100), so asserting it against the
    // engine's own recorded queue entry (rather than the pre-clamp input)
    // still proves the numbering/wrapping contract without depending on
    // DATA_DOCKS geometry the model file itself has no say over.
    const queued = e.drones.get(drone!.id)!._manualQueue!
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: queued[0] })
  })
})
