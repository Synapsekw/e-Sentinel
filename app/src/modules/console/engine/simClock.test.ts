import { describe, it, expect } from 'vitest'
import { absorbWallTime, drainBacklog, SUB_STEP, MAX_BACKLOG } from './simClock'

describe('simClock', () => {
  it('accumulates wall time scaled by timeScale, capped at MAX_BACKLOG', () => {
    expect(absorbWallTime(0, 1000, 1, MAX_BACKLOG)).toBeCloseTo(1, 5)
    expect(absorbWallTime(0, 1000, 4, MAX_BACKLOG)).toBeCloseTo(4, 5)
    expect(absorbWallTime(29, 5000, 1, MAX_BACKLOG)).toBe(MAX_BACKLOG)
  })
  it('drains the backlog in sub-steps no larger than SUB_STEP and returns the remainder', () => {
    const steps: number[] = []
    const rem = drainBacklog(1.2, SUB_STEP, (s) => steps.push(s))
    expect(steps).toEqual([0.5, 0.5, 0.2])
    expect(rem).toBeCloseTo(0, 5)
  })
})
