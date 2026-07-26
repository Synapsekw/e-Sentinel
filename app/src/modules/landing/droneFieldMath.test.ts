import { describe, it, expect } from 'vitest'
import {
  Track,
  TRAIL,
  WAVE_MS,
  hash2,
  noise2,
  waveRadius,
  revealAt,
  shelterAt,
  steerToward,
  maxRadiusFrom,
} from './droneFieldMath'

describe('Track', () => {
  it('holds the most recent samples, oldest first, once past capacity', () => {
    const t = new Track(4)
    for (let i = 1; i <= 6; i++) t.push(i, i * 10)
    expect(t.length).toBe(4)
    expect([t.x(0), t.x(1), t.x(2), t.x(3)]).toEqual([3, 4, 5, 6])
    expect([t.y(0), t.y(1), t.y(2), t.y(3)]).toEqual([30, 40, 50, 60])
  })

  it('never exceeds capacity or reads a stale slot, over many wraps', () => {
    const cap = TRAIL
    const t = new Track(cap)
    const expected: number[] = []
    for (let n = 1; n <= 500; n++) {
      t.push(n, n * 2)
      expected.push(n)
      if (expected.length > cap) expected.shift()
      expect(t.length).toBe(expected.length)
      for (let i = 0; i < t.length; i++) {
        expect(t.x(i)).toBe(expected[i])
        expect(t.y(i)).toBe(expected[i] * 2)
      }
    }
  })

  // A craft that respawns elsewhere must not draw a line from its old position
  // to its new one, which is exactly what a retained history would produce.
  it('drops its history on reset', () => {
    const t = new Track(8)
    for (let i = 0; i < 20; i++) t.push(i, i)
    t.reset()
    expect(t.length).toBe(0)
    t.push(99, 99)
    expect(t.length).toBe(1)
    expect(t.x(0)).toBe(99)
  })
})

describe('noise2', () => {
  it('stays within [0,1]', () => {
    for (let i = 0; i < 400; i++) {
      const v = noise2((i * 7.3) % 53, (i * 3.1) % 31)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic and continuous between lattice points', () => {
    expect(noise2(4.25, 9.5)).toBe(noise2(4.25, 9.5))
    const a = noise2(4, 9)
    const b = noise2(4.01, 9)
    expect(Math.abs(a - b)).toBeLessThan(0.05)
  })

  it('hashes to a unit interval', () => {
    for (const [x, y] of [
      [0, 0],
      [-12, 7],
      [99999, -99999],
    ]) {
      const v = hash2(x, y)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('waveRadius', () => {
  it('grows from zero and clears every corner once the sweep is done', () => {
    const maxR = 900
    expect(waveRadius(0, maxR)).toBe(0)
    const early = waveRadius(400, maxR)
    const mid = waveRadius(1300, maxR)
    expect(early).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(early)
    expect(waveRadius(WAVE_MS, maxR)).toBeGreaterThan(maxR)
    expect(waveRadius(WAVE_MS * 10, maxR)).toBeGreaterThan(maxR)
  })

  it('eases out, so the front decelerates as it reaches the edges', () => {
    const maxR = 900
    const first = waveRadius(400, maxR) - waveRadius(0, maxR)
    const lastLeg = waveRadius(WAVE_MS - 1, maxR) - waveRadius(WAVE_MS - 401, maxR)
    expect(first).toBeGreaterThan(lastLeg)
  })
})

describe('revealAt', () => {
  it('hides craft ahead of the front and fully shows those behind it', () => {
    expect(revealAt(500, 400)).toBe(0)
    expect(revealAt(400, 400)).toBe(0)
    expect(revealAt(0, 400)).toBe(1)
    const edge = revealAt(350, 400)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
  })
})

describe('shelterAt', () => {
  const box = { cx: 500, cy: 400, hw: 350, hh: 300 }

  it('is dimmest inside the content block and full strength well outside it', () => {
    const behind = shelterAt(box.cx, box.cy, box)
    const outside = shelterAt(box.cx + box.hw + 400, box.cy, box)
    expect(behind).toBeCloseTo(0.12, 5)
    expect(outside).toBe(1)
    expect(outside).toBeGreaterThan(behind)
  })

  it('ramps monotonically as it moves away from the block', () => {
    let prev = -1
    for (let d = 0; d <= 600; d += 40) {
      const v = shelterAt(box.cx + box.hw + d, box.cy, box)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('stays within [0,1] anywhere on the page', () => {
    for (let x = -200; x <= 1400; x += 100) {
      for (let y = -200; y <= 1100; y += 100) {
        const v = shelterAt(x, y, box)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('steerToward', () => {
  it('turns no further than the rate limit', () => {
    expect(steerToward(0, Math.PI, 0.1)).toBeCloseTo(0.1, 6)
    expect(steerToward(0, -Math.PI / 2, 0.1)).toBeCloseTo(-0.1, 6)
  })

  it('snaps to the target when it is within the limit', () => {
    expect(steerToward(1, 1.05, 0.5)).toBeCloseTo(1.05, 6)
  })

  // Without shortest-way-around handling a craft near the wrap point turns the
  // long way and visibly loops instead of correcting by a few degrees.
  it('takes the short way around the wrap point', () => {
    const from = 3.0
    const to = -3.0
    const next = steerToward(from, to, 0.2)
    expect(next).toBeCloseTo(3.2, 6)
  })
})

describe('maxRadiusFrom', () => {
  it('measures to the farthest corner', () => {
    expect(maxRadiusFrom(0, 0, 300, 400)).toBeCloseTo(500, 6)
    expect(maxRadiusFrom(150, 200, 300, 400)).toBeCloseTo(250, 6)
  })
})
