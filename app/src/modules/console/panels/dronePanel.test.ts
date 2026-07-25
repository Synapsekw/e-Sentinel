import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { missionLineFor, fpvCruising, rtbDisabled, holdDisabled, distHomeKm } from './dronePanel'
import type { Drone } from '@/modules/console/domain'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
}
const stub = (state: Drone['state']): Drone => ({ state }) as Drone

describe('drone panel model', () => {
  it('missionLineFor prefixes the mission label and percent when on a mission', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.missionId && x.state !== 'docked')
    if (d) expect(missionLineFor(e, d)).toMatch(/·\s\d+%\s·/)
  })

  it('missionLineFor falls back to the state label with no mission', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.state === 'docked')!
    expect(missionLineFor(e, d)).toBe('DOCKED')
  })

  it('fpvCruising matches FPV_LIVE_STATES exactly (panels.js:434)', () => {
    for (const s of ['transit', 'on-task', 'rtb', 'hold', 'manual'] as const) {
      expect(fpvCruising(stub(s))).toBe(true)
    }
    for (const s of ['docked', 'takeoff', 'landing'] as const) {
      expect(fpvCruising(stub(s))).toBe(false)
    }
  })

  it('RTB is enabled only in transit/on-task/hold (panels.js:519)', () => {
    expect(rtbDisabled(stub('transit'))).toBe(false)
    expect(rtbDisabled(stub('hold'))).toBe(false)
    expect(rtbDisabled(stub('takeoff'))).toBe(true)
  })

  it('HOLD is enabled while held or in transit/on-task (panels.js:521)', () => {
    expect(holdDisabled(stub('hold'))).toBe(false)
    expect(holdDisabled(stub('on-task'))).toBe(false)
    expect(holdDisabled(stub('landing'))).toBe(true)
  })

  it('distHomeKm is a finite non-negative distance', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.state !== 'docked')
    if (d) {
      const km = distHomeKm(e, d)
      expect(Number.isFinite(km)).toBe(true)
      expect(km).toBeGreaterThanOrEqual(0)
    }
  })
})
