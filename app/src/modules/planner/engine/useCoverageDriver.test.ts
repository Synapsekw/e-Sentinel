import { describe, it, expect } from 'vitest'
import { shouldApply, COVERAGE_DEBOUNCE_MS } from './useCoverageDriver'

describe('shouldApply', () => {
  it('applies a result computed from the current revision', () => {
    expect(shouldApply(7, 7)).toBe(true)
  })

  it('discards a result whose plan revision is already stale', () => {
    // The plan changed while the computation was in flight. Writing this
    // result would show numbers for a plan that no longer exists.
    expect(shouldApply(6, 7)).toBe(false)
  })

  it('debounces at 150ms', () => {
    expect(COVERAGE_DEBOUNCE_MS).toBe(150)
  })
})
