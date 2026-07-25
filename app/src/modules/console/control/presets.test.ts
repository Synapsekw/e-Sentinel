// Ported (Phase 1E / Task 4) test for presets.ts -- see that file's header
// for legacy source refs (control.js:739-778).

import { describe, it, expect } from 'vitest'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import { PRESET_NEAR, PRESET_ORDER, presetTypes } from './presets'

describe('mission presets', () => {
  it('covers every configured mission type in the legacy order', () => {
    expect(presetTypes(MISSIONS_CONFIG)).toEqual(PRESET_ORDER)
  })
  it('each preset has a UAE-bounded geographic bias', () => {
    for (const type of PRESET_ORDER) {
      const near = PRESET_NEAR[type]
      expect(near).toBeTruthy()
      expect(near![0]).toBeGreaterThan(51)
      expect(near![0]).toBeLessThan(57)
      expect(near![1]).toBeGreaterThan(22)
      expect(near![1]).toBeLessThan(27)
    }
  })
  it('appends any config type missing from the fixed order', () => {
    const cfg = { ...MISSIONS_CONFIG, extra: MISSIONS_CONFIG.security } as typeof MISSIONS_CONFIG
    expect(presetTypes(cfg)).toEqual([...PRESET_ORDER, 'extra'])
  })
})
