import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import type { Engine, Track } from '@/modules/console/domain'
import { fmtETA } from '@/modules/console/chrome/format'
import {
  TRACK_STATUS_CHIP,
  TRACK_EXPIRY_AMBER_S,
  activeTrackCount,
  trackAgeStr,
  trackExpiryS,
} from './trackModel'

function mk(): Engine {
  return SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
}

// Synthetic track builder, mirroring domain/tracks.test.ts's inline literals
// (the T-series shape) so age/expiry/status can be asserted deterministically
// without waiting on the engine's stochastic detection spawn.
function track(overrides: Partial<Track>): Track {
  return {
    id: 'TRK-1',
    label: 'FLAGGED VEHICLE',
    missionType: 'security',
    pos: [55.3, 25.2],
    sourceDrone: 'D-X',
    sourceMission: 'M-X',
    detectedAt: 0,
    expiresAt: 600,
    status: 'active',
    missionId: null,
    dockId: null,
    homeDockId: 'X',
    ...overrides,
  }
}

describe('track model', () => {
  it('TRACK_STATUS_CHIP maps every status to its legacy chip class + text (panels.js:1468-1473)', () => {
    expect(TRACK_STATUS_CHIP.active).toEqual({ cls: 'amber', text: 'ACTIVE' })
    expect(TRACK_STATUS_CHIP.tasked).toEqual({ cls: 'steel', text: 'TASKED' })
    expect(TRACK_STATUS_CHIP.resolved).toEqual({ cls: '', text: 'RESOLVED' })
    expect(TRACK_STATUS_CHIP.expired).toEqual({ cls: 'dim', text: 'EXPIRED' })
  })

  it('TRACK_EXPIRY_AMBER_S matches console.css:599 (<60s threshold)', () => {
    expect(TRACK_EXPIRY_AMBER_S).toBe(60)
  })

  it('activeTrackCount counts only status === "active" (panels.js:1480-1489)', () => {
    const e = mk()
    e.tracks.set('TRK-1', track({ id: 'TRK-1', status: 'active' }))
    e.tracks.set('TRK-2', track({ id: 'TRK-2', status: 'tasked' }))
    e.tracks.set('TRK-3', track({ id: 'TRK-3', status: 'active' }))
    e.tracks.set('TRK-4', track({ id: 'TRK-4', status: 'resolved' }))
    e.tracks.set('TRK-5', track({ id: 'TRK-5', status: 'expired' }))
    expect(activeTrackCount(e)).toBe(2)
  })

  it('activeTrackCount is 0 without an engine', () => {
    expect(activeTrackCount(null)).toBe(0)
  })

  it('trackAgeStr renders T+M:SS sim time since detection (panels.js:1490-1495)', () => {
    const e = mk()
    for (let i = 0; i < 125; i++) e.tick(1) // now ~= 125s
    const t = track({ detectedAt: 5 })
    expect(trackAgeStr(e, t)).toBe('T+' + fmtETA(e.now - 5))
  })

  it('trackAgeStr clamps to T+0:00 when detectedAt has not happened yet relative to now', () => {
    const e = mk()
    const t = track({ detectedAt: e.now + 1000 })
    expect(trackAgeStr(e, t)).toBe('T+0:00')
  })

  it('trackAgeStr reads 0 sim time without an engine', () => {
    const t = track({ detectedAt: 0 })
    expect(trackAgeStr(null, t)).toBe('T+0:00')
  })

  it('trackExpiryS is the remaining seconds until expiry, clamped at 0 (panels.js:1497-1501)', () => {
    const e = mk()
    for (let i = 0; i < 10; i++) e.tick(1) // now ~= 10s
    const t = track({ expiresAt: e.now + 42 })
    expect(trackExpiryS(e, t)).toBeCloseTo(42, 0)
  })

  it('trackExpiryS clamps to 0 once past expiry', () => {
    const e = mk()
    for (let i = 0; i < 10; i++) e.tick(1)
    const expired = track({ expiresAt: e.now - 100 })
    expect(trackExpiryS(e, expired)).toBe(0)
  })
})
