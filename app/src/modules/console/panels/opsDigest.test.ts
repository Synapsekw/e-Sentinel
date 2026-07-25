import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import {
  digestStatsLine,
  digestActiveMissions,
  lastDetections,
  isDetectionEvent,
  detectionBody,
} from './opsDigest'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 1200; i++) e.tick(0.5)
  return e
}

describe('ops digest model', () => {
  it('shows the static line without an engine (panels.js:173)', () => {
    expect(digestStatsLine(null)).toBe('104 DOCK STATIONS ONLINE · ALL 7 EMIRATES')
  })

  it('derives the live stats line from engine state', () => {
    const e = bootedEngine()
    let ready = 0,
      alerts = 0,
      airborne = 0
    for (const d of e.docks.values()) {
      if (d.state === 'ready') ready++
      else if (d.state === 'fault' || d.state === 'offline') alerts++
    }
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    const line = digestStatsLine(e)
    expect(line).toContain('AIRBORNE ' + airborne)
    expect(line).toContain('READY ' + ready)
    expect(line).toContain('ALERTS ' + alerts)
  })

  it('lists at most 8 active missions, newest first', () => {
    const e = bootedEngine()
    const ms = digestActiveMissions(e)
    expect(ms.length).toBeLessThanOrEqual(8)
    expect(ms.every((m) => m.state === 'active')).toBe(true)
    const t = ms.map((m) => m.startedAt)
    expect(t).toEqual([...t].sort((a, b) => b - a))
  })

  it('recognises detection events and strips the leading source id', () => {
    const e = bootedEngine()
    const dets = lastDetections(e, 3)
    expect(dets.length).toBeLessThanOrEqual(3)
    for (const d of dets) {
      expect(isDetectionEvent(d)).toBe(true)
      expect(detectionBody(d).startsWith(d.source + ' ')).toBe(false)
    }
  })

  it('rejects non-detection events', () => {
    expect(
      isDetectionEvent({ time: 0, level: 'alert', source: 'AUH-01', message: 'DOCK FAULT' }),
    ).toBe(false)
  })
})
