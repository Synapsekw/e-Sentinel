import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE, VIDEO_MANIFEST } from '@/modules/console/domain'
import type { Mission } from '@/modules/console/domain'
import {
  ANALYTICS_FORMATS,
  humanizeKey,
  formatAnalyticsValue,
  analyticsEntries,
  debriefVideoSources,
  routeGeometry,
  analyticsSummaryLine,
  timeHHMM,
  computeVideoVariant,
  missionReportText,
  SESSION_MISSIONS_CAP,
} from './debriefModel'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 4000; i++) e.tick(0.5)
  return e
}

function findCompletedMission(): Mission {
  const e = bootedEngine()
  const found = [...e.missions.values()].find((m) => m.state === 'complete')
  expect(found).toBeTruthy()
  return found!
}

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

describe('debrief model', () => {
  it('formatAnalyticsValue matches every ANALYTICS_FORMATS entry (panels.js:648-659)', () => {
    expect(formatAnalyticsValue('timeToSceneS', 42)).toBe('42S')
    expect(formatAnalyticsValue('etaDeltaS', 15)).toBe('+15S')
    expect(formatAnalyticsValue('etaDeltaS', -5)).toBe('-5S')
    expect(formatAnalyticsValue('etaDeltaS', 0)).toBe('0S')
    expect(formatAnalyticsValue('payloadKg', 2.5)).toBe('2.5 KG')
    expect(formatAnalyticsValue('areaHa', 1234.5)).toBe('1,234.5 HA')
    expect(formatAnalyticsValue('volumeDeltaM3', 2500)).toBe('2,500 M³')
    expect(formatAnalyticsValue('ndviMean', 0.62)).toBe('0.62')
    expect(formatAnalyticsValue('coveragePct', 97)).toBe('97%')
    expect(formatAnalyticsValue('progressPct', 55)).toBe('55%')
    expect(formatAnalyticsValue('stressedPct', 4.2)).toBe('4.2%')
    expect(formatAnalyticsValue('palmCount', 3200)).toBe('3,200')
    // Every key ANALYTICS_FORMATS declares must actually be exercised above.
    expect(Object.keys(ANALYTICS_FORMATS).sort()).toEqual(
      [
        'timeToSceneS',
        'etaDeltaS',
        'payloadKg',
        'areaHa',
        'volumeDeltaM3',
        'ndviMean',
        'coveragePct',
        'progressPct',
        'stressedPct',
        'palmCount',
      ].sort(),
    )
  })

  it('formatAnalyticsValue falls back to String(v) for unknown scalar keys, and joins arrays', () => {
    expect(formatAnalyticsValue('vehiclesFlagged', 3)).toBe('3')
    expect(formatAnalyticsValue('sceneTags', ['ACCESS CLEAR', '2 VEHICLES'])).toBe(
      'ACCESS CLEAR · 2 VEHICLES',
    )
  })

  it('humanizeKey uses the explicit label for known keys', () => {
    expect(humanizeKey('timeToSceneS')).toBe('TIME TO SCENE')
  })

  it('humanizeKey falls back to camelCase -> SPACED UPPER for unknown keys', () => {
    expect(humanizeKey('vehiclesFlagged')).toBe('VEHICLES FLAGGED')
    expect(humanizeKey('platesFlagged')).toBe('PLATES FLAGGED')
  })

  it('analyticsEntries covers every analytics key on a completed engine mission', () => {
    const mission = findCompletedMission()
    const entries = analyticsEntries(mission)
    const keys = Object.keys(mission.analytics || {})
    expect(entries.length).toBe(keys.length)
    for (const k of keys) {
      expect(entries.some((e) => e.label === humanizeKey(k))).toBe(true)
    }
  })

  it('analyticsEntries is empty when analytics is null', () => {
    expect(analyticsEntries(stubMission({ analytics: null }))).toEqual([])
  })

  it('debriefVideoSources prefixes every clip with BASE_URL (panels.js:692-695)', () => {
    const mission = stubMission({ type: 'security' })
    const sources = debriefVideoSources(mission)
    expect(sources.length).toBe(VIDEO_MANIFEST.security.length)
    for (let i = 0; i < sources.length; i++) {
      expect(sources[i]).toBe(`${import.meta.env.BASE_URL}videos/${VIDEO_MANIFEST.security[i]}`)
    }
  })

  it('debriefVideoSources is empty when the manifest has no clips for the type', () => {
    // Every configured MissionType has at least one clip in this app's
    // fixture data, so exercise the "missing entirely" branch directly.
    const mission = stubMission({ type: 'security' })
    expect(debriefVideoSources({ ...mission, type: 'nope' as never }).length).toBe(0)
  })

  it('routeGeometry needs at least two waypoints', () => {
    expect(routeGeometry([])).toBe(null)
    expect(routeGeometry([[55.2, 25.1]])).toBe(null)
  })

  it('routeGeometry returns one point per waypoint, all inside the given box', () => {
    const w = 240
    const h = 140
    const geo = routeGeometry(
      [
        [55.2, 25.1],
        [55.3, 25.15],
        [55.25, 25.2],
      ],
      w,
      h,
    )
    expect(geo).not.toBe(null)
    expect(geo!.points.length).toBe(3)
    expect(geo!.path.split(' ').length).toBe(3)
    for (const p of geo!.points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(w)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(h)
    }
    // Three interior 25/50/75% marks.
    expect(geo!.marks.length).toBe(3)
  })

  it('routeGeometry collapses a degenerate span to the box center on that axis', () => {
    // A straight north-south leg: spanX === 0.
    const geo = routeGeometry(
      [
        [55.2, 25.1],
        [55.2, 25.3],
      ],
      240,
      140,
    )
    expect(geo).not.toBe(null)
    for (const p of geo!.points) expect(p.x).toBeCloseTo(120, 5)
  })

  it('analyticsSummaryLine reports NO ANALYTICS with nothing captured (panels.js:1002)', () => {
    expect(analyticsSummaryLine(stubMission({ analytics: null }))).toBe('NO ANALYTICS')
    expect(analyticsSummaryLine(stubMission({ analytics: {} }))).toBe('NO ANALYTICS')
  })

  it('analyticsSummaryLine joins at most the first two entries', () => {
    const mission = stubMission({
      analytics: { detections: 2, platesFlagged: 1, coveragePct: 96 },
    })
    const line = analyticsSummaryLine(mission)
    expect(line).toBe('DETECTIONS 2 · PLATES FLAGGED 1')
  })

  it('timeHHMM formats a Date and falls back for anything else', () => {
    expect(timeHHMM(null)).toBe('--:--')
    expect(timeHHMM(undefined)).toBe('--:--')
    const d = new Date(2026, 0, 1, 13, 5)
    expect(timeHHMM(d)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('computeVideoVariant rotates through the manifest, 0 when there are no clips', () => {
    expect(computeVideoVariant('security', 0)).toBe(0)
    expect(computeVideoVariant('security', 1)).toBe(1)
    expect(computeVideoVariant('security', VIDEO_MANIFEST.security.length)).toBe(0)
  })

  it('SESSION_MISSIONS_CAP matches shared/store.ts (panels.js:1099-1122)', () => {
    expect(SESSION_MISSIONS_CAP).toBe(40)
  })

  it('missionReportText embeds the mission id, type label and analytics rows', () => {
    const mission = stubMission({
      id: 'M-0007',
      type: 'security',
      analytics: { detections: 2 },
      waypoints: [
        [55.2, 25.1],
        [55.3, 25.2],
      ],
    })
    const html = missionReportText(mission)
    expect(html).toContain('SENTINEL REPORT · M-0007')
    expect(html).toContain('M-0007')
    expect(html).toContain('SECURITY PATROL')
    expect(html).toContain('DETECTIONS')
    expect(html).toContain('route-svg')
    expect(html).toContain('window.print()')
  })

  it('missionReportText omits the route block under two waypoints', () => {
    const html = missionReportText(stubMission({ waypoints: [] }))
    expect(html).not.toContain('route-svg')
    expect(html).not.toContain('Route snapshot')
  })
})
