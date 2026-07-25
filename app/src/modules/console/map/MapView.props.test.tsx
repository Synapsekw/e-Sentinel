// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// Mock maplibre-gl to avoid jsdom errors with WebGL canvas setup
vi.mock('maplibre-gl', () => ({
  default: vi.fn(),
}))

import { MAP_VIEW_DEFAULTS } from './MapView'

describe('MapView defaults', () => {
  it('keeps the console globe-entry camera as the default', () => {
    // Guards against a planner-driven refactor silently changing the camera
    // the console boots at (zoom 1.4 is the orbital globe start).
    expect(MAP_VIEW_DEFAULTS.center).toEqual([54.6, 24.3])
    expect(MAP_VIEW_DEFAULTS.zoom).toBe(1.4)
  })
})
