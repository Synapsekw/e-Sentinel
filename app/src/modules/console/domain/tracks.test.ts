// Ported (Phase 1A / Task 6) from tests/tracks.test.js — detection tracks
// (contracts T-1/T-2) — per the assertion mapping in the task brief. Test
// names and assertions kept identical. The ported engine takes
// SimRouter/MISSIONS_CONFIG/DOCK_RANGE via imports, so (unlike the legacy
// test) nothing is placed on globalThis.

import { describe, it, expect } from 'vitest'
import { SimEngine, type Engine } from './engine'
import { SimRouter } from './router'
import { DOCK_RANGE, DATA_DOCKS } from './docks'
import { GEO_UAE } from './geo-uae'
import type { Track, Dock, DockSeed, LonLat, MissionType, SimEvent } from './types'

const R = SimRouter
const RANGE = DOCK_RANGE
const DOCKS = DATA_DOCKS

const ELIGIBLE_TYPES: MissionType[] = ['security', 'highway', 'infra', 'parks']
const TRACK_LABELS: Partial<Record<MissionType, string>> = {
  security: 'FLAGGED VEHICLE',
  highway: 'FLAGGED VEHICLE',
  infra: 'THERMAL ANOMALY',
  parks: 'VEGETATION STRESS ZONE',
}

function mk(): Engine {
  return SimEngine.create({ docks: DOCKS, roads: GEO_UAE.roads })
}
function actives(e: Engine): Track[] {
  return [...e.tracks.values()].filter((t) => t.status === 'active')
}
// Spawn is stochastic (0.4 per detection, detections ~0.0067/s per on-task
// drone) but with 104 docks and airborne target 14, a track appears within a
// couple hundred sim-seconds. Bounded loop keeps runtime sane.
function tickToFirstTrack(e: Engine, maxS?: number): Track {
  for (let i = 0; i < (maxS || 1500) && e.tracks.size === 0; i++) e.tick(1)
  expect(e.tracks.size >= 1).toBeTruthy() // expected a track to spawn
  return [...e.tracks.values()][0]
}
// Mirrors taskTrack's dock-selection bar so tests can find a track that is
// provably taskable at the moment of the call (no ticks in between).
function eligibleDockFor(e: Engine, track: Track): Dock | null {
  const reserved = new Set(
    [...e.requests.values()].filter((r) => r.status === 'pending' && r.dockId).map((r) => r.dockId),
  )
  let best: Dock | null = null,
    bestD = Infinity
  for (const d of e.docks.values()) {
    if (
      d.state !== 'ready' ||
      d.battery < 60 ||
      !d.drone ||
      d.drone.state !== 'docked' ||
      reserved.has(d.id)
    )
      continue
    const dist = R.distM(d.coords, track.pos)
    if (dist <= RANGE.dockRangeKm(d) * 1000 * 0.9 && dist < bestD) {
      bestD = dist
      best = d
    }
  }
  return best
}
function findTaskableTrack(e: Engine, maxS?: number): Track {
  for (let i = 0; i < (maxS || 4000); i++) {
    e.tick(1)
    for (const t of e.tracks.values()) {
      if (t.status === 'active' && eligibleDockFor(e, t)) return t
    }
  }
  throw new Error('no taskable active track found within the window')
}

describe('tracks', () => {
  // ---- T-1: spawn + shape ----

  it('track spawns during on-task flight with the full T-1 shape', () => {
    const e = mk()
    const t = tickToFirstTrack(e)

    expect(t.id).toBe('TRK-201') // ids start at TRK-201
    expect(ELIGIBLE_TYPES.includes(t.missionType)).toBeTruthy() // missionType must be track-eligible
    expect(t.label).toBe(TRACK_LABELS[t.missionType]) // label matches the detection noun
    expect(
      Array.isArray(t.pos) && Number.isFinite(t.pos[0]) && Number.isFinite(t.pos[1]),
    ).toBeTruthy()
    expect(t.sourceDrone).toMatch(/^D-/)
    const drone = e.drones.get(t.sourceDrone)
    expect(drone).toBeTruthy() // sourceDrone must reference a real drone
    expect(t.homeDockId).toBe(drone!.dockId) // home dock is the detecting drone's dock
    const mission = e.missions.get(t.sourceMission)
    expect(mission).toBeTruthy() // sourceMission must reference the origin mission
    expect(mission!.type).toBe(t.missionType)
    expect(Number.isFinite(t.detectedAt) && t.detectedAt <= e.now).toBeTruthy()
    expect(t.expiresAt).toBe(t.detectedAt + 600) // expiry is detectedAt + 600
    expect(t.status).toBe('active')
    expect(t.missionId).toBe(null)
    expect(t.dockId).toBe(null)

    // Detection happened mid-flight, so the track sits inside the source
    // dock's coverage (same 1.05x tolerance createMission uses).
    const home = e.docks.get(t.homeDockId)!
    const rangeM = RANGE.dockRangeKm(home) * 1000
    expect(R.distM(home.coords, t.pos) <= rangeM * 1.05).toBeTruthy() // track position must sit inside the source dock range
  })

  it('only security/highway/infra/parks missions spawn tracks', () => {
    const e = mk()
    const seenTypes: MissionType[] = []
    e.onEvent((ev) => {
      if (ev.code === 'TRACK_NEW') {
        const t = e.tracks.get(ev.trackId!)
        expect(t).toBeTruthy() // TRACK_NEW must reference a live track
        seenTypes.push(t!.missionType)
      }
    })
    for (let i = 0; i < 3000; i++) e.tick(1)
    expect(seenTypes.length >= 5).toBeTruthy() // expected a broad sample
    for (const type of seenTypes) {
      expect(ELIGIBLE_TYPES.includes(type)).toBeTruthy() // ineligible mission type spawned a track
    }
  })

  it('active track count never exceeds 8', () => {
    const e = mk()
    let spawned = 0
    e.onEvent((ev) => {
      if (ev.code === 'TRACK_NEW') spawned++
    })
    for (let i = 0; i < 4000; i++) {
      e.tick(1)
      expect(actives(e).length <= 8).toBeTruthy() // active tracks exceeded 8
    }
    expect(spawned > 8).toBeTruthy() // expected enough spawns to exercise the cap
  })

  // ---- T-2: event contracts ----

  it('TRACK_NEW emits at warn level from OPS, after a DETECTION carrying the trackId', () => {
    const e = mk()
    const evs: SimEvent[] = []
    e.onEvent((ev) => {
      if (ev.code === 'DETECTION' || ev.code === 'TRACK_NEW') evs.push(ev)
    })
    const t = tickToFirstTrack(e)

    const trackNew = evs.find((ev) => ev.code === 'TRACK_NEW' && ev.trackId === t.id)
    expect(trackNew).toBeTruthy() // a TRACK_NEW event should fire
    const foundTrackNew = trackNew!
    expect(foundTrackNew.level).toBe('warn')
    expect(foundTrackNew.source).toBe('OPS')
    expect(foundTrackNew.message.includes(t.id)).toBeTruthy() // message names the track id
    expect(foundTrackNew.message.includes(t.label)).toBeTruthy() // message names the label
    expect(foundTrackNew.message.includes(t.sourceDrone)).toBeTruthy() // message names the source drone

    const det = evs.find((ev) => ev.code === 'DETECTION' && ev.trackId === t.id)
    expect(det).toBeTruthy() // the spawning detection carries the trackId
    const foundDet = det!
    expect(evs.indexOf(foundDet) < evs.indexOf(foundTrackNew)).toBeTruthy() // detection precedes TRACK_NEW
  })

  it('detections that do not spawn a track still carry code DETECTION, no trackId', () => {
    const e = mk()
    const evs: SimEvent[] = []
    e.onEvent((ev) => {
      if (ev.code === 'DETECTION') evs.push(ev)
    })
    for (let i = 0; i < 2000; i++) e.tick(1)
    expect(evs.length >= 5).toBeTruthy() // expected a sample of detections
    const plain = evs.filter((ev) => !ev.trackId)
    expect(plain.length >= 1).toBeTruthy() // expected at least one non-spawning detection
    for (const ev of evs) expect(ev.level).toBe('info')
  })

  // ---- T-1: expiry + prune ----

  it('active track expires 600s after detection with TRACK_EXPIRED', () => {
    const e = mk()
    const t = tickToFirstTrack(e)
    let ev: SimEvent | null = null
    e.onEvent((x) => {
      if (x.code === 'TRACK_EXPIRED' && x.trackId === t.id) ev = x
    })
    const target = t.expiresAt + 5
    for (let i = 0; i < 3000 && e.now < target; i++) e.tick(1)
    expect(t.status).toBe('expired')
    expect(ev).toBeTruthy() // a TRACK_EXPIRED event should fire
    expect(ev!.level).toBe('info')
    expect(ev!.message.includes(t.id)).toBeTruthy()
    expect(ev!.message.includes('NO ACTION TAKEN')).toBeTruthy()
    expect(ev!.time >= t.expiresAt).toBeTruthy() // expiry must not fire early
  })

  it('tracks map stays <=20, evicting oldest resolved/expired first, never active/tasked', () => {
    const e = mk()
    // Synthetic backlog: 4 active + 1 tasked (never evictable) + 21 finished.
    const keep: Track[] = []
    for (let i = 0; i < 5; i++) {
      const t: Track = {
        id: 'TRK-9' + i,
        label: 'FLAGGED VEHICLE',
        missionType: 'security',
        pos: [55.3, 25.2],
        sourceDrone: 'D-X',
        sourceMission: 'M-X',
        detectedAt: i,
        expiresAt: 999999,
        status: i === 0 ? 'tasked' : 'active',
        missionId: null,
        dockId: null,
        homeDockId: 'X',
      }
      keep.push(t)
      e.tracks.set(t.id, t)
    }
    for (let i = 0; i < 21; i++) {
      e.tracks.set('TRK-8' + i, {
        id: 'TRK-8' + i,
        label: 'THERMAL ANOMALY',
        missionType: 'infra',
        pos: [55.3, 25.2],
        sourceDrone: 'D-X',
        sourceMission: 'M-X',
        detectedAt: 100 + i,
        expiresAt: 999999,
        status: i % 2 ? 'resolved' : 'expired',
        missionId: null,
        dockId: null,
        homeDockId: 'X',
      })
    }
    expect(e.tracks.size).toBe(26)
    e.tick(1) // lifecycle pass prunes
    expect(e.tracks.size <= 20).toBeTruthy() // tracks map must be pruned to <=20
    for (const t of keep) {
      expect(e.tracks.has(t.id)).toBeTruthy() // active/tasked track must never be evicted
    }
    // Oldest finished (detectedAt 100..105) go first.
    for (let i = 0; i < 6; i++) {
      expect(e.tracks.has('TRK-8' + i)).toBeFalsy() // oldest finished track should be evicted
    }
  })

  // ---- T-2: tasking ----

  it('taskTrack launches an investigation mission from the nearest eligible dock', () => {
    const e = mk()
    const t = findTaskableTrack(e)
    const expectedDock = eligibleDockFor(e, t)!
    const evs: SimEvent[] = []
    e.onEvent((ev) => {
      if (ev.code === 'TRACK_TASKED') evs.push(ev)
    })

    const m = e.taskTrack(t.id)
    expect(m && m.state === 'active').toBeTruthy()
    expect(m.type).toBe(t.missionType) // mission type matches the track origin type
    expect(m.trackId).toBe(t.id)
    expect(t.status).toBe('tasked')
    expect(t.missionId).toBe(m.id)
    expect(t.dockId).toBe(m.dockId)
    expect(m.dockId).toBe(expectedDock.id) // nearest eligible in-range dock is chosen

    const dock = e.docks.get(m.dockId)!
    expect(dock.drone.state).toBe('takeoff') // drone should launch on tasking
    expect(dock.drone.missionId).toBe(m.id)
    const rangeM = RANGE.dockRangeKm(dock) * 1000
    expect(m.waypoints.length >= 2).toBeTruthy()
    for (const wp of m.waypoints) {
      expect(R.distM(dock.coords, wp) <= rangeM * 1.05).toBeTruthy() // waypoint outside 1.05x dock range
    }

    const ev = evs.find((x) => x.trackId === t.id)
    expect(ev).toBeTruthy() // a TRACK_TASKED event should fire
    expect(ev!.level).toBe('info')
    expect(ev!.dockId).toBe(m.dockId)
    expect(ev!.message.includes(t.id)).toBeTruthy()
    expect(ev!.message.includes(dock.drone.id)).toBeTruthy() // message names the investigating drone
  })

  it('taskTrack on a non-active track throws', () => {
    const e = mk()
    const t = tickToFirstTrack(e)
    expect(() => e.taskTrack('TRK-99999')).toThrow(/Track not active/)
    expect(e.dismissTrack(t.id)).toBeTruthy()
    expect(() => e.taskTrack(t.id)).toThrow(/Track not active/)
  })

  it('taskTrack skips docks reserved by pending flight requests', () => {
    const e = mk()
    const t = findTaskableTrack(e)
    const expectedDock = eligibleDockFor(e, t)
    expect(expectedDock).toBeTruthy() // precondition: a dock is eligible
    const foundExpectedDock = expectedDock!
    // Synthetic pending request pinning the dock taskTrack would otherwise
    // pick — the reservation must make it invisible to track tasking.
    e.requests.set('REQ-TEST', {
      id: 'REQ-TEST',
      customer: 'TEST',
      customerFull: 'TEST',
      type: 'security',
      place: 'TEST',
      coords: [0, 0],
      priority: 'ROUTINE',
      params: { altM: 80, speedMs: 10 },
      requestedAt: e.now,
      status: 'pending',
      dockId: foundExpectedDock.id,
      waypoints: null,
      missionId: null,
    })
    try {
      const m = e.taskTrack(t.id)
      expect(m.dockId).not.toBe(foundExpectedDock.id) // tasking must not launch from a request-reserved dock
      expect(t.status).toBe('tasked')
    } catch (err) {
      // No alternate dock covers the point: the reservation makes tasking fail.
      expect((err as Error).message).toMatch(/NO READY DOCK IN RANGE/)
      expect(t.status).toBe('active') // failed tasking leaves the track active
    }
  })

  // ---- T-2: resolution ----

  it('dismissTrack resolves an active track and emits TRACK_DISMISSED', () => {
    const e = mk()
    const t = tickToFirstTrack(e)
    let ev: SimEvent | null = null
    e.onEvent((x) => {
      if (x.code === 'TRACK_DISMISSED') ev = x
    })
    expect(e.dismissTrack(t.id)).toBe(true)
    expect(t.status).toBe('resolved')
    expect(ev).toBeTruthy() // a TRACK_DISMISSED event should fire
    expect(ev!.level).toBe('info')
    expect(ev!.trackId).toBe(t.id)
    expect(ev!.message.includes('OPERATOR')).toBeTruthy()
    // second dismiss and unknown ids are no-ops
    expect(e.dismissTrack(t.id)).toBe(false)
    expect(e.dismissTrack('TRK-99999')).toBe(false)
  })

  it('full lifecycle: task, fly, complete -> track resolved with TRACK_RESOLVED', () => {
    const e = mk()
    const t = findTaskableTrack(e)
    let resolved: SimEvent | null = null
    e.onEvent((ev) => {
      if (ev.code === 'TRACK_RESOLVED' && ev.trackId === t.id) resolved = ev
    })

    const m = e.taskTrack(t.id)
    for (let i = 0; i < 7200 && t.status !== 'resolved'; i++) e.tick(1)

    expect(m.state).toBe('complete')
    expect(t.status).toBe('resolved')
    expect(resolved).toBeTruthy() // a TRACK_RESOLVED event should fire
    expect(resolved!.level).toBe('info')
    expect(resolved!.message.includes(t.id)).toBeTruthy()
    expect(resolved!.message.includes(t.label)).toBeTruthy() // message names the label
  })

  // ---- Airborne divert fallback ----

  // A single isolated dock: once its drone is airborne, no ready dock covers
  // anything nearby — the only way to task a track is to divert the flyer.
  function mkIsolated(): Engine {
    const docks: DockSeed[] = [
      { id: 'ISO-001', name: 'Isolated', emirate: 'AUH', coords: [54.0, 23.5], model: 'M4TD' },
    ]
    return SimEngine.create({ docks, roads: { type: 'FeatureCollection', features: [] } })
  }

  function syntheticTrack(e: Engine, pos: LonLat): Track {
    const track: Track = {
      id: 'TRK-T1',
      label: 'FLAGGED VEHICLE',
      missionType: 'security',
      pos: pos,
      sourceDrone: 'D-ISO-001',
      sourceMission: 'M-ISO-001-1',
      detectedAt: e.now,
      expiresAt: e.now + 600,
      status: 'active',
      missionId: null,
      dockId: null,
      homeDockId: 'ISO-001',
    }
    e.tracks.set(track.id, track)
    return track
  }

  it('taskTrack diverts the nearest airborne drone when no dock is ready', () => {
    const e = mkIsolated()
    const first = e.launchPreset('security', { dockId: 'ISO-001' })
    for (let i = 0; i < 60; i++) e.tick(1) // airborne, mid-mission
    const drone = e.drones.get('D-ISO-001')!
    expect(drone.state === 'transit' || drone.state === 'on-task').toBeTruthy()

    const track = syntheticTrack(e, [54.005, 23.505]) // ~700m from the dock
    const mission = e.taskTrack('TRK-T1')

    expect(first.state).toBe('complete') // old ambient mission wrapped up
    expect(drone.missionId).toBe(mission.id)
    expect(drone.state).toBe('transit')
    expect(mission.trackId).toBe('TRK-T1')
    expect(track.status).toBe('tasked')
    expect(track.dockId).toBe('ISO-001')
    const rangeM = RANGE.dockRangeKm({ coords: [54.0, 23.5] }) * 1000
    for (const wp of mission.waypoints) {
      expect(R.distM([54.0, 23.5], wp) <= rangeM * 1.05).toBeTruthy() // orbit stays in the home ring
    }
    const ev = e.events[e.events.length - 1]
    expect(ev.code).toBe('TRACK_TASKED')
    expect(/DIVERTED/.test(ev.message)).toBeTruthy()

    // The diverted mission flies to completion and resolves the track.
    for (let i = 0; i < 3600 && track.status !== 'resolved'; i++) e.tick(1)
    expect(track.status).toBe('resolved')
  })

  it('divert never steals a drone serving a customer request', () => {
    const e = mkIsolated()
    // Fabricate a pending request from the only dock, approve it -> the sole
    // drone is now on request business and must not be divertable.
    e.requests.set('REQ-T1', {
      id: 'REQ-T1',
      customer: 'DMT',
      customerFull: 'X',
      type: 'security',
      place: 'ISOLATED',
      coords: [54.01, 23.51],
      priority: 'ROUTINE',
      params: { altM: 80, speedMs: 12 },
      requestedAt: e.now,
      status: 'pending',
      dockId: 'ISO-001',
      waypoints: R.orbit([54.01, 23.51], 400, 12),
      missionId: null,
    })
    e.approveRequest('REQ-T1')
    for (let i = 0; i < 40; i++) e.tick(1)
    syntheticTrack(e, [54.005, 23.505])
    expect(() => e.taskTrack('TRK-T1')).toThrow(/NO READY DOCK IN RANGE/)
  })
})
