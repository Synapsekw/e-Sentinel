import { describe, it, expect } from 'vitest'
import { shortestLngDelta, altKmFromZoom, fmtAlt, nextGlobeCenter } from './globeMath'

describe('globe math', () => {
  it('shortestLngDelta wraps across the antimeridian', () => {
    expect(shortestLngDelta(10, 350)).toBe(20)
    expect(shortestLngDelta(350, 10)).toBe(-20)
  })
  it('altKmFromZoom interpolates orbit->theater on a log scale', () => {
    expect(altKmFromZoom(1.35, 1.35, 6.6)).toBeCloseTo(12742, 0)
    expect(altKmFromZoom(6.6, 1.35, 6.6)).toBeCloseTo(2, 0)
  })
  it('fmtAlt rounds above 100 and keeps one decimal below', () => {
    expect(fmtAlt(12742)).toBe('12742')
    expect(fmtAlt(2.4)).toBe('2.4')
  })
  it('nextGlobeCenter steps toward the beacon meridian and reports settled', () => {
    const near = nextGlobeCenter({ lng: 54.42, lat: 24.3 }, [54.4, 24.3], 24.3, 0.016)
    expect(near.settled).toBe(true)
    const far = nextGlobeCenter({ lng: 120, lat: 24.3 }, [54.4, 24.3], 24.3, 0.016)
    expect(far.settled).toBe(false)
    expect(far.lng).toBeLessThan(120)
  })
})
