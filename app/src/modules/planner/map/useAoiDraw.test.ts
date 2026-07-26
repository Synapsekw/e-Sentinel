import { describe, it, expect, vi } from 'vitest'
import type maplibregl from 'maplibre-gl'
import { teardownDraw } from './useAoiDraw'

describe('teardownDraw', () => {
  it('stops the draw instance when the map is still alive', () => {
    const stop = vi.fn()
    const map = { style: {} } as unknown as maplibregl.Map
    teardownDraw({ stop }, map)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does NOT touch the draw instance once the map has been removed', () => {
    // MapView nulls mapRef and calls map.remove() BEFORE this cleanup runs on
    // route navigation (React tears deleted subtrees down parent-first), so
    // stopping terra-draw here would dereference a torn-down Style.
    const stop = vi.fn()
    const removedMap = {} as unknown as maplibregl.Map // no .style => removed
    teardownDraw({ stop }, removedMap)
    expect(stop).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no draw instance', () => {
    expect(() => teardownDraw(null, { style: {} } as never)).not.toThrow()
  })
})
