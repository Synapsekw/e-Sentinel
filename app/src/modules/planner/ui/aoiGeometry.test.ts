import { describe, it, expect } from 'vitest'
import { formatAoiArea } from './aoiGeometry'
import type { Aoi } from '../domain/types'

const base = { id: 'a1', name: 'A', source: 'drawn' as const }

// A square degree or so of Abu Dhabi -- big enough that a wrong figure is
// obvious rather than a rounding argument.
const box: Aoi = {
  ...base,
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.2, 24.1],
        [54.55, 24.1],
        [54.55, 24.45],
        [54.2, 24.45],
        [54.2, 24.1],
      ],
    ],
  },
}

// The two lobes wind in opposite directions, so turf's SIGNED area cancels
// them: this reports 0.0 km2 for a shape covering real ground.
const bowtie: Aoi = {
  ...base,
  valid: false,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.7, 24.1],
        [55.05, 24.45],
        [55.05, 24.1],
        [54.7, 24.45],
        [54.7, 24.1],
      ],
    ],
  },
}

describe('formatAoiArea', () => {
  it('reports a valid area plainly', () => {
    expect(formatAoiArea(box)).toMatch(/^\d+\.\d KM2$/)
  })

  it('reports an invalid area as an upper bound, not a cancelled-out zero', () => {
    // The regression this exists for: turf's signed area over this ring is
    // ~0, so the panel used to read "0.0 KM2" beside a rectangle covering
    // most of a degree.
    const text = formatAoiArea(bowtie)
    expect(text).not.toBe('0.0 KM2')
    expect(text).toMatch(/^≤ \d+\.\d KM2$/)
  })

  it('bounds an invalid area by its box, so the figure matches what the map draws', () => {
    // Same footprint as `box`, just self-intersecting -- so the bound has to
    // land on the same figure the valid square reports.
    expect(formatAoiArea(bowtie)).toBe(`≤ ${formatAoiArea(box)}`)
  })

  it('reports no figure at all when the geometry cannot even be bounded', () => {
    // A ring collapsed to a line has no box, so there is no honest number to
    // show -- not even an upper bound.
    const flat: Aoi = {
      ...base,
      valid: false,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [54.5, 24.2],
            [54.7, 24.2],
            [54.6, 24.2],
            [54.5, 24.2],
          ],
        ],
      },
    }
    expect(formatAoiArea(flat)).toBe('—')
  })
})
