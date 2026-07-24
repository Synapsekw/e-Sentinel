import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS } from '@/modules/console/domain'

describe('domain barrel alias', () => {
  it('resolves the @ alias and exposes the domain API', () => {
    expect(typeof SimEngine.create).toBe('function')
    expect(DATA_DOCKS.length).toBe(104)
  })
})
