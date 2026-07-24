// Ported (Phase 1A / Task 6) from tests/requests.test.js — customer flight
// request queue (contracts R-1..R-3) — per the assertion mapping in the task
// brief. Test names and assertions kept identical. The ported engine takes
// SimRouter/MISSIONS_CONFIG/DOCK_RANGE via imports, so (unlike the legacy
// test) nothing is placed on globalThis.

import { describe, it, expect } from 'vitest'
import { SimEngine, type Engine } from './engine'
import { SimRouter } from './router'
import { DOCK_RANGE, DATA_DOCKS } from './docks'
import { GEO_UAE } from './geo-uae'
import { MISSIONS_CONFIG } from './missions-config'
import type { FlightRequest, SimEvent, Dock } from './types'

const R = SimRouter
const RANGE = DOCK_RANGE
const DOCKS = DATA_DOCKS

function mk(): Engine {
  return SimEngine.create({ docks: DOCKS, roads: GEO_UAE.roads })
}
function pendings(e: Engine): FlightRequest[] {
  return [...e.requests.values()].filter((r) => r.status === 'pending')
}
// Tick until at least one pending request exists (spawn is seeded but the
// first pass can theoretically skip; contract says first at ~15s).
function tickToFirstRequest(e: Engine): FlightRequest {
  for (let i = 0; i < 200 && pendings(e).length === 0; i++) e.tick(1)
  const p = pendings(e)
  expect(p.length >= 1).toBeTruthy() // expected a pending request to spawn
  return p[0]
}

describe('requests', () => {
  // ---- R-2: spawn timing + caps ----

  it('first flight request spawns by ~20s sim and ids read REQ-101...', () => {
    const e = mk()
    for (let i = 0; i < 20; i++) e.tick(1)
    const p = pendings(e)
    expect(p.length >= 1).toBeTruthy() // expected >=1 pending request by 20s
    expect(p[0].id).toMatch(/^REQ-\d+$/)
    const n = Number(p[0].id!.slice(4))
    expect(n >= 101).toBeTruthy() // ids should start at REQ-101
  })

  it('pending requests never exceed 4 over a long untended run', () => {
    const e = mk()
    for (let i = 0; i < 3000; i++) {
      e.tick(1)
      expect(pendings(e).length <= 4).toBeTruthy() // pending count exceeded 4
    }
    expect(pendings(e).length >= 1).toBeTruthy() // requests should have accumulated
  })

  it('requests map stays <=20 with pruning of resolved requests', () => {
    const e = mk()
    let spawned = 0
    for (let i = 0; i < 4000; i++) {
      e.tick(1)
      for (const r of pendings(e)) {
        e.declineRequest(r.id!)
        spawned++
      }
      expect(e.requests.size <= 20).toBeTruthy() // requests map exceeded 20
    }
    expect(spawned > 20).toBeTruthy() // expected enough spawns to exercise pruning
  })

  // ---- R-1: request shape ----

  it('request carries the full R-1 shape with in-range coords and waypoints', () => {
    const e = mk()
    const req = tickToFirstRequest(e)

    expect(req.id).toMatch(/^REQ-\d+$/)
    expect(typeof req.customer).toBe('string')
    expect(req.customer.length >= 2 && req.customer === req.customer.toUpperCase()).toBeTruthy()
    expect(typeof req.customerFull).toBe('string')
    expect(MISSIONS_CONFIG[req.type]).toBeTruthy() // type must be a MISSIONS_CONFIG key
    expect(typeof req.place).toBe('string')
    expect(req.place).toBe(req.place.toUpperCase())
    expect(
      Array.isArray(req.coords) && Number.isFinite(req.coords[0]) && Number.isFinite(req.coords[1]),
    ).toBeTruthy()
    expect(['ROUTINE', 'PRIORITY', 'URGENT'].includes(req.priority)).toBeTruthy()
    expect(
      Number.isFinite(req.params.altM) && req.params.altM >= 40 && req.params.altM <= 120,
    ).toBeTruthy()
    expect(
      Number.isFinite(req.params.speedMs) && req.params.speedMs >= 5 && req.params.speedMs <= 21,
    ).toBeTruthy()
    expect(Number.isFinite(req.requestedAt)).toBeTruthy()
    expect(req.status).toBe('pending')
    expect(req.missionId).toBe(null)

    const dock = e.docks.get(req.dockId)
    expect(dock).toBeTruthy() // dockId must reference a real dock
    const foundDock = dock!
    const rangeM = RANGE.dockRangeKm(foundDock) * 1000
    expect(R.distM(foundDock.coords, req.coords) <= rangeM).toBeTruthy() // request point must sit inside the assigned dock range
    expect(Array.isArray(req.waypoints) && req.waypoints.length >= 2).toBeTruthy()
    for (const wp of req.waypoints!) {
      expect(R.distM(foundDock.coords, wp) <= rangeM * 1.05).toBeTruthy() // waypoint outside 1.05x dock range
    }
  })

  it('urgent priority is reserved for emergency requests', () => {
    const e = mk()
    const seen: FlightRequest[] = []
    for (let i = 0; i < 6000; i++) {
      e.tick(1)
      for (const r of pendings(e)) {
        seen.push(r)
        e.declineRequest(r.id!)
      }
    }
    expect(seen.length >= 10).toBeTruthy() // expected a broad sample
    for (const r of seen) {
      if (r.priority === 'URGENT') expect(r.type).toBe('emergency')
      if (r.type === 'emergency') expect(r.priority).toBe('URGENT')
    }
  })

  // ---- R-2: event contract ----

  it('FLIGHT_REQUEST events emit at warn level with requestId extra', () => {
    const e = mk()
    const evs: SimEvent[] = []
    e.onEvent((ev) => {
      if (ev.code === 'FLIGHT_REQUEST') evs.push(ev)
    })
    const req = tickToFirstRequest(e)
    expect(evs.length >= 1).toBeTruthy() // a FLIGHT_REQUEST event should fire
    const ev = evs.find((x) => x.requestId === req.id)
    expect(ev).toBeTruthy() // event must carry requestId matching the request
    const foundEv = ev!
    expect(foundEv.level).toBe('warn')
    expect(foundEv.message.includes(req.customer)).toBeTruthy() // message names the customer
    expect(foundEv.message.includes(req.place)).toBeTruthy() // message names the place
  })

  // ---- R-3: approve ----

  it('approveRequest creates a linked mission and launches the drone', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    const evs: SimEvent[] = []
    e.onEvent((ev) => {
      if (ev.code === 'REQUEST_APPROVED') evs.push(ev)
    })

    const m = e.approveRequest(req.id!)
    expect(m && m.state === 'active').toBeTruthy()
    expect(m.type).toBe(req.type)
    expect(m.params.altM).toBe(req.params.altM)
    expect(m.params.speedMs).toBe(req.params.speedMs)
    expect(m.requestId).toBe(req.id)
    expect(m.requestedBy).toBe(req.customer)
    expect(req.status).toBe('approved')
    expect(req.missionId).toBe(m.id)
    expect(m.dockId).toBe(req.dockId) // request dockId reflects the launching dock

    const dock = e.docks.get(m.dockId)!
    expect(dock.drone.state).toBe('takeoff') // drone should launch on approval
    expect(dock.drone.missionId).toBe(m.id)

    const ev = evs.find((x) => x.requestId === req.id)
    expect(ev).toBeTruthy() // a REQUEST_APPROVED event should fire
    expect(ev!.dockId).toBe(m.dockId)
    expect(ev!.level).toBe('info')
  })

  it('approveRequest on a non-pending request is rejected', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    expect(e.declineRequest(req.id!)).toBeTruthy()
    expect(() => e.approveRequest(req.id!)).toThrow(/Request not pending/)
    expect(() => e.approveRequest('REQ-99999')).toThrow(/Request not pending/)
  })

  it('approveRequest re-plans from another ready dock when the assigned one is busy', () => {
    const e = mk()
    // Whether a neighbor can cover a request point depends on dock geography,
    // so hunt for a request that provably has an alternate eligible dock
    // within a conservative 0.7x of that dock's range (the engine accepts up
    // to 0.9x, so this guarantees the re-plan can succeed). Decline the rest.
    function alternateDockFor(req: FlightRequest): Dock | undefined {
      return [...e.docks.values()].find(
        (d) =>
          d.id !== req.dockId &&
          d.state === 'ready' &&
          d.battery >= 60 &&
          !!d.drone &&
          d.drone.state === 'docked' &&
          R.distM(d.coords, req.coords) <= RANGE.dockRangeKm(d) * 1000 * 0.7,
      )
    }
    let req: FlightRequest | null = null
    for (let i = 0; i < 6000 && !req; i++) {
      e.tick(1)
      for (const r of pendings(e)) {
        if (!req && alternateDockFor(r)) {
          req = r
          break
        }
        e.declineRequest(r.id!)
      }
    }
    expect(req).toBeTruthy() // expected a request coverable by a second dock within the window
    const foundReq = req!
    const originalDock = e.docks.get(foundReq.dockId)!
    originalDock.state = 'fault' // assigned dock knocked out before approval

    const m = e.approveRequest(foundReq.id!)
    expect(m && m.state === 'active').toBeTruthy()
    expect(m.dockId).not.toBe(originalDock.id) // mission must launch from a different dock
    expect(foundReq.dockId).toBe(m.dockId) // request re-points at the launching dock
    const dock = e.docks.get(m.dockId)!
    const rangeM = RANGE.dockRangeKm(dock) * 1000
    for (const wp of m.waypoints) {
      expect(R.distM(dock.coords, wp) <= rangeM * 1.05).toBeTruthy() // re-planned waypoint outside coverage
    }
  })

  it('approveRequest throws NO READY DOCK IN RANGE when nothing is eligible', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    for (const dock of e.docks.values()) dock.state = 'fault'
    expect(() => e.approveRequest(req.id!)).toThrow(/NO READY DOCK IN RANGE/)
    expect(req.status).toBe('pending') // failed approval leaves the request pending
  })

  // ---- R-3: decline ----

  it('declineRequest resolves the request and emits REQUEST_DECLINED', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    let ev: SimEvent | null = null
    e.onEvent((x) => {
      if (x.code === 'REQUEST_DECLINED') ev = x
    })
    expect(e.declineRequest(req.id!)).toBe(true)
    expect(req.status).toBe('declined')
    expect(ev).toBeTruthy() // a REQUEST_DECLINED event should fire
    expect(ev!.requestId).toBe(req.id)
    expect(ev!.level).toBe('info')
    expect(ev!.message.includes(req.customer)).toBeTruthy()
    // second decline is a no-op
    expect(e.declineRequest(req.id!)).toBe(false)
  })

  // ---- Completion linkage ----

  it('full lifecycle: approve, fly, complete -> request fulfilled', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    let fulfilled: SimEvent | null = null
    e.onEvent((ev) => {
      if (ev.code === 'REQUEST_FULFILLED' && ev.requestId === req.id) fulfilled = ev
    })

    const m = e.approveRequest(req.id!)
    for (let i = 0; i < 7200 && req.status !== 'completed'; i++) e.tick(1)

    expect(m.state).toBe('complete')
    expect(req.status).toBe('completed')
    expect(fulfilled).toBeTruthy() // a REQUEST_FULFILLED event should fire
    expect(fulfilled!.level).toBe('info')
    expect(fulfilled!.message.includes(req.customer)).toBeTruthy()
  })

  // ---- Dock reservation ----

  it('scheduler never takes a dock reserved by a pending request', () => {
    const e = mk()
    const req = tickToFirstRequest(e)
    // Long run at full scheduler churn: the reserved dock's drone must still be
    // docked (and the dock un-launched) when the operator finally approves.
    for (let i = 0; i < 600 && req.status === 'pending'; i++) {
      e.tick(1)
      const drone = e.docks.get(req.dockId)!.drone
      // The drone may be away only if a mission it flies belongs to this
      // request (impossible while pending) — so it must stay docked.
      expect(drone.state).toBe('docked') // reserved dock lost its drone
    }
    const mission = e.approveRequest(req.id!)
    expect(mission.dockId).toBe(req.dockId) // approval should use the reserved dock
  })
})
