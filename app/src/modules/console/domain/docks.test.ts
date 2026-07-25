// Ported (Phase 1A / Task 1) from tests/docks.test.js per the assertion
// mapping in the task brief. Test names and assertions kept identical.

import { describe, it, expect } from 'vitest'
import { DATA_DOCKS } from './docks'

describe('docks', () => {
  it('104 docks', () => expect(DATA_DOCKS.length).toBe(104))

  it('unique ids, valid shape', () => {
    const ids = new Set<string>()
    for (const d of DATA_DOCKS) {
      expect(d.id).toMatch(/^(AUH|DXB|SHJ|AJM|UAQ|RAK|FUJ|AAN)-\d{3}$/)
      expect(!ids.has(d.id)).toBeTruthy()
      ids.add(d.id)
      expect(['M4TD', 'M4D', 'M350'].includes(d.model)).toBeTruthy()
      const [lon, lat] = d.coords
      expect(lon > 51.0 && lon < 56.6 && lat > 22.5 && lat < 26.3).toBeTruthy()
    }
  })

  it('emirate coverage', () => {
    const c: Record<string, number> = {}
    for (const d of DATA_DOCKS) c[d.emirate] = (c[d.emirate] || 0) + 1
    expect(
      (c.AUH ?? 0) >= 26 &&
        (c.DXB ?? 0) >= 22 &&
        (c.SHJ ?? 0) >= 10 &&
        (c.RAK ?? 0) >= 8 &&
        (c.FUJ ?? 0) >= 6 &&
        (c.AAN ?? 0) >= 6 &&
        (c.AJM ?? 0) >= 3 &&
        (c.UAQ ?? 0) >= 3,
    ).toBeTruthy()
  })
})
