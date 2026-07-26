// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useBasemap } from './useBasemap'
import { useAppStore } from '@/shared/store'

// Fake map implementing only the slice useBasemap touches: setLayoutProperty,
// setPaintProperty, getLayer, plus `style` for isMapUsable-style probes.
// Same approach as planner/map/useDockPlacement.test.ts's makeFakeMap.
function makeFakeMap() {
  const setLayoutProperty = vi.fn()
  const setPaintProperty = vi.fn()
  const mapLike = {
    style: {},
    setLayoutProperty,
    setPaintProperty,
    getLayer: vi.fn((id: string) => ({ id })),
  }
  return {
    map: mapLike as unknown as maplibregl.Map,
    setLayoutProperty,
    setPaintProperty,
  }
}

const pristine = useAppStore.getState()

describe('useBasemap enabled gate', () => {
  let fake: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    fake = makeFakeMap()
    mapRef = { current: fake.map }
    useAppStore.setState({ ...pristine, scene: 'globe', layer: 'dark', offline: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStore.setState(pristine)
  })

  it('touches no layer at all when disabled', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    expect(fake.setLayoutProperty).not.toHaveBeenCalled()
    expect(fake.setPaintProperty).not.toHaveBeenCalled()
  })

  it('applies the basemap when the parameter is omitted, so the console is unchanged', () => {
    renderHook(() => useBasemap(mapRef, true))
    // raster-dark/light/sat/terrain visibility is set on every apply.
    const ids = fake.setLayoutProperty.mock.calls.map((c) => c[0] as string)
    expect(ids).toContain('raster-dark')
    expect(ids).toContain('raster-sat')
  })

  it('hides the UAE cartography layers in the globe scene when enabled', () => {
    // This is the behaviour the planner must NOT inherit: uae-places driven to
    // 'none' because the store's default scene is 'globe'.
    renderHook(() => useBasemap(mapRef, true))
    const places = fake.setLayoutProperty.mock.calls.find(
      (c) => c[0] === 'uae-places' && c[1] === 'visibility',
    )
    expect(places?.[2]).toBe('none')
  })

  it('does not hide the UAE cartography layers when disabled', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    const places = fake.setLayoutProperty.mock.calls.find((c) => c[0] === 'uae-places')
    expect(places).toBeUndefined()
  })

  it('stays inert when disabled even if the store changes afterwards', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    useAppStore.setState({ layer: 'sat' })
    expect(fake.setLayoutProperty).not.toHaveBeenCalled()
  })
})
