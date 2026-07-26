import { describe, it, expect } from 'vitest'
import { isValidAoiGeometry } from './geometry'
import type { Polygon } from 'geojson'

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [54.5, 24.2],
      [54.7, 24.2],
      [54.7, 24.4],
      [54.5, 24.4],
      [54.5, 24.2],
    ],
  ],
}

// A classic bowtie: the edges (0,0)->(2,2) and (2,0)->(0,2) cross in the
// middle, so the ring is self-intersecting.
const bowtie: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0],
    ],
  ],
}

describe('isValidAoiGeometry', () => {
  it('accepts a simple, non-self-intersecting polygon', () => {
    expect(isValidAoiGeometry(square)).toBe(true)
  })

  it('rejects a self-intersecting (bowtie) ring', () => {
    expect(isValidAoiGeometry(bowtie)).toBe(false)
  })

  it('treats a shape kinks() itself cannot even parse as invalid, instead of throwing', () => {
    // @turf/kinks is lenient about most degenerate rings (a collapsed-point
    // ring, an empty ring, all resolve to "zero intersections found" rather
    // than throwing), but it does throw on a coordinates value that is not
    // an array at all -- confirmed by calling it directly against this exact
    // shape before writing this test. A hand-edited or corrupted import can
    // produce that. Cast past the Polygon type here (not something a real
    // caller could construct through this module's own types) specifically
    // to exercise that throw path.
    const malformed = { type: 'Polygon', coordinates: null } as unknown as Polygon
    expect(() => isValidAoiGeometry(malformed)).not.toThrow()
    expect(isValidAoiGeometry(malformed)).toBe(false)
  })
})
