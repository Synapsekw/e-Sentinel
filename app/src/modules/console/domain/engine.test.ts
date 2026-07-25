// Ported (Phase 1A / Task 5) from tests/engine.test.js per the assertion
// mapping in the task brief. Test names and assertions kept identical. The
// ported engine takes SimRouter/MISSIONS_CONFIG via imports, so (unlike the
// legacy test) nothing is placed on globalThis — the imported engine is used
// directly.

import { describe, it, expect } from 'vitest'
import { SimEngine } from './engine'
import { SimRouter } from './router'
import { DATA_DOCKS } from './docks'
import { GEO_UAE } from './geo-uae'

function mk() {
  return SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
}

describe('engine', () => {
  it('boots with all docks ready, none airborne', () => {
    const e = mk()
    expect(e.docks.size).toBe(104)
    expect([...e.drones.values()].filter((d) => d.state !== 'docked').length).toBe(0)
  })

  it('scheduler reaches airborne target', () => {
    const e = mk()
    for (let i = 0; i < 600; i++) e.tick(1) // 10 sim minutes
    const air = [...e.drones.values()].filter((d) => !['docked'].includes(d.state)).length
    expect(air >= 10).toBeTruthy()
  })

  it('mission lifecycle completes and yields analytics', () => {
    const e = mk()
    // In-range route (createMission now rejects waypoints outside the dock's
    // coverage ring, contract C-1) — DXB-001 is urban, 3 km radius.
    const m = e.createMission({
      type: 'highway',
      dockId: 'DXB-001',
      waypoints: SimRouter.perimeter([55.263, 25.185], 2500, 8),
      params: { altM: 100, speedMs: 15 },
    })
    // The legacy test declared a `done` flag here, set from an onEvent
    // subscription watching for the COMPLETE message, but never asserted on
    // it. Under strict TS (noUnusedLocals) that never-read local cannot
    // compile, and adding an assertion would change the test, so the dead
    // flag is dropped. All 13 assertions below are unchanged.
    for (let i = 0; i < 7200 && m.state !== 'complete'; i++) e.tick(1)
    expect(m.state).toBe('complete')
    expect((m.analytics as Record<string, number>).vehiclesFlagged >= 0).toBeTruthy()
  })

  it('battery floor forces RTB', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'AUH-001',
      waypoints: SimRouter.perimeter([54.349, 24.477], 2800, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    d.battery = 26
    for (let i = 0; i < 300; i++) e.tick(1)
    expect(['rtb', 'landing', 'docked'].includes(d.state)).toBeTruthy()
  })

  it('drones never leave UAE bbox', () => {
    const e = mk()
    for (let i = 0; i < 1800; i++) e.tick(1)
    for (const d of e.drones.values()) {
      expect(d.pos[0] > 51 && d.pos[0] < 56.7 && d.pos[1] > 22.4 && d.pos[1] < 26.4).toBeTruthy()
    }
  })

  // ---- Task 10: commandRTB / commandHold ----

  it('commandRTB from on-task ends in docked eventually', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'AUH-001',
      waypoints: SimRouter.perimeter([54.349, 24.477], 2800, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')

    expect(e.commandRTB(d.id)).toBeTruthy()
    expect(d.state).toBe('rtb')

    for (let i = 0; i < 3600 && d.state !== 'docked'; i++) e.tick(1)
    expect(d.state).toBe('docked')
  })

  it('commandHold freezes progress while battery drains, resume continues', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: SimRouter.perimeter([55.263, 25.185], 3000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')
    for (let i = 0; i < 5; i++) e.tick(1)

    expect(e.commandHold(d.id, true)).toBeTruthy()
    expect(d.state).toBe('hold')
    const progressAtHold = m.progress
    const battAtHold = d.battery

    for (let i = 0; i < 20; i++) e.tick(1)
    expect(m.progress).toBe(progressAtHold)
    expect(d.battery < battAtHold).toBeTruthy()

    expect(e.commandHold(d.id, false)).toBeTruthy()
    expect(d.state).toBe('on-task')
    for (let i = 0; i < 20; i++) e.tick(1)
    expect(m.progress > progressAtHold).toBeTruthy()
  })

  // ---- Task 11: setManual / manualGoto / manualQueue / nudgeAlt ----

  it('setManual engages from on-task, flies to a click-to-go target, then hovers on arrival', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'AUH-001',
      waypoints: SimRouter.perimeter([54.349, 24.477], 2800, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')

    expect(e.setManual(d.id, true)).toBeTruthy()
    expect(d.state).toBe('manual')
    expect(d.speedMs).toBe(0)

    // Target halfway back toward the home dock — guaranteed inside the
    // coverage ring, so the new manualGoto range clamp leaves it untouched.
    const dock = e.docks.get(d.dockId)!
    const target: [number, number] = [
      (d.pos[0] + dock.coords[0]) / 2,
      (d.pos[1] + dock.coords[1]) / 2,
    ]
    expect(e.manualGoto(d.id, target)).toBeTruthy()

    let sawMovement = false
    let arrived = false
    for (let i = 0; i < 600 && !arrived; i++) {
      e.tick(1)
      if (d.speedMs > 0) sawMovement = true
      if (d.speedMs === 0 && d._manualQueue!.length === 0) arrived = true
    }
    expect(sawMovement).toBeTruthy()
    expect(arrived).toBeTruthy()
    expect(d.speedMs).toBe(0)
    expect(SimRouter.distM(d.pos, target) < 50).toBeTruthy()
  })

  it('battery floor during manual control releases control and forces RTB', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: SimRouter.perimeter([55.263, 25.185], 3000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')

    expect(e.setManual(d.id, true)).toBeTruthy()
    expect(e.manualQueue(d.id, [d.pos[0] + 0.05, d.pos[1] + 0.05])).toBeTruthy()
    d.battery = 26

    let releasedEvent = false
    e.onEvent((ev) => {
      if (ev.message.includes('MANUAL RELEASED')) releasedEvent = true
    })

    for (let i = 0; i < 300 && d.state === 'manual'; i++) e.tick(1)
    expect(releasedEvent).toBeTruthy()
    expect(['rtb', 'landing', 'docked'].includes(d.state)).toBeTruthy()
    expect(d._manualQueue!.length).toBe(0)

    for (let i = 0; i < 3600 && d.state !== 'docked'; i++) e.tick(1)
    expect(d.state).toBe('docked')
  })

  it('releasing manual control returns the drone to its prior state while the mission is active', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'AUH-002',
      waypoints: SimRouter.perimeter([54.435, 24.542], 3000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')

    expect(e.setManual(d.id, true)).toBeTruthy()
    expect(d.state).toBe('manual')

    expect(e.setManual(d.id, false)).toBeTruthy()
    expect(d.state).toBe('on-task')
    expect(m.state).toBe('active')

    for (let i = 0; i < 20; i++) e.tick(1)
    expect(d.state).toBe('on-task')
  })

  it('nudgeAlt clamps altitude to the 30-120m band', () => {
    const e = mk()
    const m = e.createMission({
      type: 'security',
      dockId: 'SHJ-001',
      waypoints: SimRouter.perimeter([55.39, 25.35], 3000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = [...e.drones.values()].find((x) => x.missionId === m.id)!
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    e.setManual(d.id, true)

    e.nudgeAlt(d.id, -1000)
    expect(d.alt).toBe(30)
    e.nudgeAlt(d.id, 1000)
    expect(d.alt).toBe(120)
  })

  // ---- Review-fix regression: completion-order pruning + ambient ticker cadence ----

  it('pruneFinishedMissions evicts by completion order, not creation order, keeping <=60 finished', () => {
    const e = mk()
    // One mission per dock (up to 70) via createMission directly — cheaper and
    // more deterministic than waiting on the scheduler to fill the fleet.
    const docks = [...e.docks.values()].slice(0, 70)
    const missions = docks.map((dock) =>
      e.createMission({
        type: 'security',
        dockId: dock.id,
        waypoints: SimRouter.perimeter(dock.coords, 1200, 6),
        params: { altM: 80, speedMs: 15 },
      }),
    )
    const drones = docks.map((dock) => dock.drone)

    // Let every drone clear takeoff + transit onto its on-task leg. The r=1200m/
    // speedMs=15 route keeps on-task alive for ~480s — comfortably longer than
    // the ~140s (initial wait) + ~210s (staggered forcing below) this test needs,
    // so no drone completes its route naturally before we force it.
    for (let i = 0; i < 140; i++) e.tick(1)
    expect(drones.every((d) => d.state === 'on-task' || d.state === 'transit')).toBeTruthy()

    // Force completion (commandRTB completes the mission immediately, see
    // beginRtb -> finalizeMission) in REVERSE creation order, staggered a few
    // ticks apart. This makes the earliest-CREATED missions (index 0..9) the
    // LATEST-COMPLETED ones, and the latest-created (index 60..69) the
    // EARLIEST-completed ones — decoupling completion order from creation
    // order so creation-order pruning and completion-order pruning disagree.
    for (let i = missions.length - 1; i >= 0; i--) {
      expect(e.commandRTB(drones[i].id)).toBeTruthy()
      for (let t = 0; t < 3; t++) e.tick(1)
    }

    const finished = [...e.missions.values()].filter((m) => m.state !== 'active')
    expect(finished.length <= 60).toBeTruthy()

    // Earliest-created / latest-completed missions must survive.
    const earliestCreatedIds = missions.slice(0, 10).map((m) => m.id)
    for (const id of earliestCreatedIds) {
      expect(e.missions.has(id)).toBeTruthy()
    }
    // Latest-created / earliest-completed missions should be the ones pruned.
    const earliestCompletedIds = missions.slice(-10).map((m) => m.id)
    const evicted = earliestCompletedIds.filter((id) => !e.missions.has(id)).length
    expect(evicted >= 8).toBeTruthy()
  })

  it('ambient ticker events bound the max gap to <=5s of sim time over a 10-minute window', () => {
    const e = mk()
    const times: number[] = []
    e.onEvent((ev) => {
      times.push(ev.time)
    })
    for (let i = 0; i < 600; i++) e.tick(1) // 10 sim minutes
    expect(times.length > 1).toBeTruthy()
    let maxGap = 0
    for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, times[i] - times[i - 1])
    expect(maxGap <= 5).toBeTruthy()
  })
})
