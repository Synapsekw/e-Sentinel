import { describe, it, expect } from 'vitest'
import { isValidAoiGeometry, aoiBoundsPolygon } from './geometry'
import type { MultiPolygon, Polygon } from 'geojson'

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

describe('aoiBoundsPolygon', () => {
  it('turns a self-intersecting ring into its closed bounding rectangle', () => {
    // The bowtie spans (0,0)-(2,2). The rectangle is wound counter-clockwise
    // from the south-west corner and repeats that corner to close the ring,
    // which is what a GeoJSON Polygon requires.
    expect(aoiBoundsPolygon(bowtie)).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    })
  })

  it('spans every part of a MultiPolygon, not just the first', () => {
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        square.coordinates,
        [
          [
            [55, 25],
            [56, 25],
            [56, 26],
            [55, 26],
            [55, 25],
          ],
        ],
      ],
    }
    // square is (54.5,24.2)-(54.7,24.4); the second part reaches (56,26).
    // Reading only the first part would give a maximum of 54.7/24.4.
    expect(aoiBoundsPolygon(multi)?.coordinates[0][2]).toEqual([56, 26])
  })

  it('returns null for a ring collapsed to a line, which no box could show', () => {
    // Zero height: every point sits on latitude 24.2. A zero-area polygon
    // paints nothing, so emitting one would claim a fix that isn't there.
    const flat: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.6, 24.2],
          [54.5, 24.2],
        ],
      ],
    }
    expect(aoiBoundsPolygon(flat)).toBeNull()
  })

  it('returns null instead of throwing on a geometry turf cannot parse', () => {
    // Same cast-past-the-type technique the isValidAoiGeometry tests above
    // use, and for the same reason: a hand-edited or corrupted import can
    // produce a shape no caller could build through this module's types.
    const malformed = { type: 'Polygon', coordinates: null } as unknown as Polygon
    expect(() => aoiBoundsPolygon(malformed)).not.toThrow()
    expect(aoiBoundsPolygon(malformed)).toBeNull()
  })
})
