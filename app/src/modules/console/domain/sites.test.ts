// Ported (Phase 1A / Task 2) from tests/sites.test.js per the assertion
// mapping in the task brief. Test names and assertions kept identical.

import { describe, it, expect } from 'vitest'
import { DATA_SITES } from './sites'

const EXPECTED_IDS = [
  'AAN3198',
  'AAN367',
  'AAN335',
  'AAN3165',
  'AAN393',
  'AAN3002',
  'AAN3015',
  'AUH140',
  'AUH127',
  'AUH1376',
  'AUH158',
  'AUH136',
  'AUH109',
  'AUH1284',
  'AUH110',
  'AUH1377',
  'AUH1383',
  'AUH165',
  'AUH1285',
]

describe('sites', () => {
  it('19 sites, ids match the live network table exactly', () => {
    expect(DATA_SITES.length).toBe(19)
    const ids = new Set(DATA_SITES.map((s) => s.id))
    expect(ids.size).toBe(19) // no duplicate ids
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it('status distribution is 13/4/2 and entry shape is valid', () => {
    const counts: Record<string, number> = { installed: 0, 'not-installed': 0, replace: 0 }
    for (const s of DATA_SITES) {
      expect(['installed', 'not-installed', 'replace'].includes(s.status)).toBeTruthy()
      expect(s.name).toBe(s.id) // name == Tower_ID exactly
      counts[s.status]++
    }
    expect(counts.installed).toBe(13)
    expect(counts['not-installed']).toBe(4)
    expect(counts.replace).toBe(2)
  })

  it('coords are [lon,lat] within UAE bbox (catches accidental swaps)', () => {
    for (const s of DATA_SITES) {
      const [lon, lat] = s.coords
      expect(lon > 51 && lon < 56.6 && lat > 22.5 && lat < 26.3).toBeTruthy()
      // lat values are ~23-25, lon ~54-56: lat < lon holds for every real entry,
      // so this also catches a [lat,lon] ordering mistake.
      expect(lat < lon).toBeTruthy()
    }
  })
})
