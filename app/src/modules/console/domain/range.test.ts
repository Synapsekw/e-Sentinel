// Ported (Phase 1A / Task 6) from tests/range.test.js per the assertion
// mapping in the task brief. Test names and assertions kept identical. The
// ported engine takes SimRouter/MISSIONS_CONFIG/DOCK_RANGE via imports, so
// (unlike the legacy test) nothing is placed on globalThis — the imported
// engine/router/docks are used directly.

import { describe, it, expect } from 'vitest'
import { SimEngine } from './engine'
import { SimRouter } from './router'
import { DOCK_RANGE, DATA_DOCKS } from './docks'
import { GEO_UAE } from './geo-uae'
import { MISSIONS_CONFIG } from './missions-config'
import type { MissionType, LonLat, SimEvent } from './types'

const R = SimRouter
const RANGE = DOCK_RANGE
const DOCKS = DATA_DOCKS

function mkEngine() {
  return SimEngine.create({ docks: DOCKS, roads: GEO_UAE.roads })
}

describe('range', () => {
  it('dock coverage is 3km inside a city and 5km in the open', () => {
    const urban = DOCKS.find((d) => d.id === 'DXB-001')! // Business Bay, central Dubai
    const rural = DOCKS.find((d) => d.id === 'AUH-024')! // Liwa Oasis, deep desert
    expect(RANGE.dockRangeKm(urban)).toBe(3)
    expect(RANGE.dockRangeKm(rural)).toBe(5)
  })

  it('explicit urban override wins over geography', () => {
    expect(RANGE.dockRangeKm({ coords: [53.78, 23.13], urban: true })).toBe(3)
    expect(RANGE.dockRangeKm({ coords: [55.263, 25.185], urban: false })).toBe(5)
  })

  it('every dock classifies to a valid range', () => {
    for (const d of DOCKS) {
      const km = RANGE.dockRangeKm(d)
      expect(km === 3 || km === 5).toBeTruthy()
    }
  })

  // ---- contract C-1: user-created missions must stay inside coverage ----

  it('createMission rejects a waypoint at 2x dock range', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')! // urban, 3 km
    const rangeM = RANGE.dockRangeKm(dock) * 1000
    const far = R.offsetMeters(dock.coords, rangeM * 2, 0)
    expect(() =>
      e.createMission({
        type: 'security',
        dockId: 'DXB-001',
        waypoints: [dock.coords.slice() as LonLat, far],
        params: { altM: 80, speedMs: 10 },
      }),
    ).toThrow(/WAYPOINT OUTSIDE COVERAGE/)
    // rejected launch must leave the dock/drone untouched
    expect(dock.drone.state).toBe('docked')
    expect(dock.state).toBe('ready')
    expect(dock.drone.missionId).toBe(null)
  })

  it('createMission accepts a waypoint at 0.9x dock range', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')!
    const rangeM = RANGE.dockRangeKm(dock) * 1000
    const near = R.offsetMeters(dock.coords, rangeM * 0.9, 0)
    const m = e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: [dock.coords.slice() as LonLat, near],
      params: { altM: 80, speedMs: 10 },
    })
    expect(m.state).toBe('active')
    expect(dock.drone.missionId).toBe(m.id)
  })

  it('manualGoto/manualQueue clamp out-of-range targets onto the coverage ring', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')!
    const rangeM = RANGE.dockRangeKm(dock) * 1000
    const m = e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: R.perimeter(dock.coords, 2500, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = dock.drone
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')
    expect(e.setManual(d.id, true)).toBeTruthy()

    const far = R.offsetMeters(dock.coords, rangeM * 3, rangeM * 2)
    expect(e.manualGoto(d.id, far)).toBeTruthy() // clamped goto is still accepted
    expect(d._manualQueue!.length).toBe(1)
    expect(R.distM(dock.coords, d._manualQueue![0]) <= rangeM).toBeTruthy()

    expect(e.manualQueue(d.id, far)).toBeTruthy() // clamped queue append is still accepted
    expect(d._manualQueue!.length).toBe(2)
    expect(R.distM(dock.coords, d._manualQueue![1]) <= rangeM).toBeTruthy()

    // in-range targets pass through unchanged
    const nearPt = R.offsetMeters(dock.coords, 1000, 500)
    expect(e.manualGoto(d.id, nearPt)).toBeTruthy()
    expect(Math.abs(d._manualQueue![0][0] - nearPt[0]) < 1e-9).toBeTruthy()
    expect(Math.abs(d._manualQueue![0][1] - nearPt[1]) < 1e-9).toBeTruthy()
    expect(m.state).toBe('active')
  })

  it('launchPreset still launches every mission type with in-range routes', () => {
    const e = mkEngine()
    const types = Object.keys(MISSIONS_CONFIG) as MissionType[]
    // Several rounds per type: exercises many seeded-rand route generations,
    // none of which may trip the new createMission range validation.
    for (let round = 0; round < 4; round++) {
      for (const type of types) {
        const m = e.launchPreset(type)
        expect(m.state).toBe('active') // type + ' preset should launch'
        const dock = e.docks.get(m.dockId)!
        const rangeM = RANGE.dockRangeKm(dock) * 1000
        for (const wp of m.waypoints) {
          expect(R.distM(dock.coords, wp) <= rangeM * 1.05).toBeTruthy() // preset waypoint outside coverage
        }
      }
    }
    // preset-saturated fleet keeps ticking cleanly under the new validation
    for (let i = 0; i < 200; i++) e.tick(1)

    // and on a fresh engine the auto-scheduler still launches missions
    // (its clamped routes must never trip the createMission range check)
    const e2 = mkEngine()
    for (let i = 0; i < 200; i++) e2.tick(1)
    expect(e2.missions.size > 0).toBeTruthy() // scheduler should keep creating missions
  })

  // ---- contract C-2: event semantics ----

  it('mission launch event carries code MISSION_LAUNCHED and dockId', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')!
    let launchEv: SimEvent | null = null
    e.onEvent((ev) => {
      if (ev.code === 'MISSION_LAUNCHED') launchEv = ev
    })
    const m = e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: R.perimeter(dock.coords, 2000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    expect(launchEv).toBeTruthy() // a MISSION_LAUNCHED event should fire
    expect(launchEv!.dockId).toBe('DXB-001')
    expect(launchEv!.level).toBe('info')
    expect(m.state).toBe('active')
  })

  it('battery-floor forced RTB emits at alert level', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')!
    e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: R.perimeter(dock.coords, 2000, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = dock.drone
    let rtbEv: SimEvent | null = null
    e.onEvent((ev) => {
      if (ev.message.includes('FORCED RTB')) rtbEv = ev
    })
    d.battery = 20 // below the 25% floor while airborne (takeoff counts)
    e.tick(1)
    expect(rtbEv).toBeTruthy() // a FORCED RTB event should fire at the battery floor
    expect(rtbEv!.level).toBe('alert')
  })

  it('battery-floor manual release emits at alert level with MANUAL_RELEASED code', () => {
    const e = mkEngine()
    const dock = e.docks.get('DXB-001')!
    e.createMission({
      type: 'security',
      dockId: 'DXB-001',
      waypoints: R.perimeter(dock.coords, 2500, 8),
      params: { altM: 80, speedMs: 10 },
    })
    const d = dock.drone
    for (let i = 0; i < 600 && d.state !== 'on-task'; i++) e.tick(1)
    expect(d.state).toBe('on-task')
    expect(e.setManual(d.id, true)).toBeTruthy()
    let relEv: SimEvent | null = null
    e.onEvent((ev) => {
      if (ev.code === 'MANUAL_RELEASED' && ev.message.includes('BATTERY FLOOR')) relEv = ev
    })
    d.battery = 20
    e.tick(1)
    expect(relEv).toBeTruthy() // a battery-floor MANUAL_RELEASED event should fire
    expect(relEv!.level).toBe('alert')
  })

  it('autonomous drones never fly beyond their dock coverage range', () => {
    const e = SimEngine.create({ docks: DOCKS, roads: GEO_UAE.roads })
    const MARGIN_M = 300 // clamp + lon/lat-vs-meters slack
    let maxAirborne = 0
    for (let i = 0; i < 4000; i++) {
      e.tick(1)
      let air = 0
      for (const d of e.drones.values()) {
        if (d.state === 'docked') continue
        air++
        const dock = e.docks.get(d.dockId)!
        const rangeM = RANGE.dockRangeKm(dock) * 1000
        const dist = R.distM(dock.coords, d.pos)
        expect(dist <= rangeM + MARGIN_M).toBeTruthy()
        // d.id + ' is ' + Math.round(dist) + 'm from ' + dock.id + ', beyond its ' + rangeM + 'm coverage'
      }
      maxAirborne = Math.max(maxAirborne, air)
    }
    // Sanity: the run actually exercised a busy fleet, not an idle one.
    expect(maxAirborne >= 10).toBeTruthy() // expected a busy fleet, peaked at maxAirborne
  })
})
