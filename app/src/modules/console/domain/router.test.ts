// Ported (Phase 1A / Task 4) from tests/router.test.js per the assertion
// mapping in the task brief. Test names, epsilons, and assertions kept
// identical.

import { describe, it, expect } from 'vitest'
import { SimRouter as R } from './router'

const DXB: [number, number] = [55.27, 25.2]

describe('router', () => {
  it('offsetMeters roundtrip ~1km', () => {
    const p = R.offsetMeters(DXB, 1000, 0)
    expect(Math.abs(R.pathLengthKm([DXB, p]) - 1.0)).toBeLessThan(0.02)
  })

  it('lawnmower covers area with alternating passes', () => {
    const wp = R.lawnmower(DXB, 2, 1, 200, 0)
    expect(wp.length >= 10).toBeTruthy() // 1km/200m -> ≥6 passes x 2 pts
    expect(R.pathLengthKm(wp) > 10).toBeTruthy() // total path longer than 2km width x passes
  })

  it('orbit closed and radius correct', () => {
    const wp = R.orbit(DXB, 500, 24)
    expect(wp.length).toBe(25) // closed: first == last
    expect(wp[0]).toEqual(wp[24])
    const d = R.pathLengthKm([DXB, wp[0]])
    expect(Math.abs(d - 0.5)).toBeLessThan(0.02)
  })

  it('corridor extracts sub-path of requested length', () => {
    const road: [number, number][] = [
      [54.72, 24.4],
      [55.05, 24.9],
      [55.25, 25.05],
      [55.42, 25.22],
    ]
    const wp = R.corridor(road, 0.2, 15)
    expect(Math.abs(R.pathLengthKm(wp) - 15)).toBeLessThan(1.5)
  })

  it('pointAlong interpolates with heading', () => {
    const { pos, heading } = R.pointAlong(
      [
        [55, 25],
        [55.1, 25],
      ],
      0.5,
    )
    expect(Math.abs(pos[0] - 55.05)).toBeLessThan(1e-6)
    expect(Math.abs(heading - 90)).toBeLessThan(1) // due east
  })
})
