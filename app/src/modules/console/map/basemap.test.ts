import { describe, it, expect } from 'vitest'
import { effectiveLayer } from './basemap'

describe('effectiveLayer', () => {
  it('always shows satellite in the globe scene regardless of layer', () => {
    expect(effectiveLayer('globe', 'dark')).toBe('sat')
    expect(effectiveLayer('globe', 'terrain')).toBe('sat')
  })
  it('uses the operator layer in the console scene', () => {
    expect(effectiveLayer('console', 'dark')).toBe('dark')
    expect(effectiveLayer('console', 'light')).toBe('light')
  })
})
