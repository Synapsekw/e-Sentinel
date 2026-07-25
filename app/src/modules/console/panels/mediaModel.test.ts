import { describe, it, expect } from 'vitest'
import { VIDEO_MANIFEST } from '@/modules/console/domain'
import type { Mission } from '@/modules/console/domain'
import { mediaPosterSrc, mediaFilterTypes } from './mediaModel'

const stubMission = (over: Partial<Mission>): Mission => ({
  id: 'M-TEST',
  type: 'security',
  dockId: 'AUH-01',
  waypoints: [],
  params: { altM: 80, speedMs: 12 },
  progress: 1,
  state: 'complete',
  analytics: null,
  startedAt: 0,
  distanceKm: 1,
  durationS: 60,
  _milestones: {},
  ...over,
})

describe('media model', () => {
  it('mediaPosterSrc prefixes the first manifest clip with BASE_URL and a #t=0.8 scrub hint (panels.js:1010-1014)', () => {
    const src = mediaPosterSrc('security')
    expect(src).toBe(`${import.meta.env.BASE_URL}videos/${VIDEO_MANIFEST.security[0]}#t=0.8`)
  })

  it('mediaPosterSrc returns null when the manifest has no clip for the type', () => {
    expect(mediaPosterSrc('nope' as never)).toBe(null)
  })

  it('mediaFilterTypes dedupes in first-seen order (panels.js:1023-1026)', () => {
    const missions = [
      stubMission({ id: 'M-1', type: 'infra' }),
      stubMission({ id: 'M-2', type: 'security' }),
      stubMission({ id: 'M-3', type: 'infra' }),
      stubMission({ id: 'M-4', type: 'emergency' }),
      stubMission({ id: 'M-5', type: 'security' }),
    ]
    expect(mediaFilterTypes(missions)).toEqual(['infra', 'security', 'emergency'])
  })

  it('mediaFilterTypes is empty for an empty session', () => {
    expect(mediaFilterTypes([])).toEqual([])
  })
})
