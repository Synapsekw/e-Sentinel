// Ported (Phase 1A / Task 3) from tests/geo.test.js per the assertion
// mapping in the task brief. Test names and assertions kept identical.

import { describe, it, expect } from 'vitest'
import { GEO_WORLD } from './geo-world'
import { GEO_UAE } from './geo-uae'

describe('geo', () => {
  it('world land present', () => {
    expect(GEO_WORLD.features.length > 0).toBeTruthy()
  })

  it('uae bundle shape', () => {
    const u = GEO_UAE
    expect(u.borders.features.length === 1).toBeTruthy()
    expect(u.roads.features.length >= 6).toBeTruthy()
    expect(u.places.features.length >= 10).toBeTruthy()
  })

  it('roads inside UAE bbox', () => {
    for (const f of GEO_UAE.roads.features) {
      if (f.geometry.type !== 'LineString') continue
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(lon > 51 && lon < 56.6).toBeTruthy()
        expect(lat > 22.5 && lat < 26.3).toBeTruthy()
      }
    }
  })
})
