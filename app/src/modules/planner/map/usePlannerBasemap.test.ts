// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { usePlannerBasemap } from './usePlannerBasemap'
import { useAppStore } from '@/shared/store'

const RASTER_IDS = ['raster-dark', 'raster-light', 'raster-sat', 'raster-terrain'] as const

// Same fake-map convention as usePlannerLayers.test.ts: only the slice of
// maplibregl.Map this hook actually touches, plus the `style` field
// isMapUsable probes. getLayer answers for every layer buildBaseStyle really
// contains, so the DARK_OVERLAY_IDS and uae-places branches are exercised.
function makeFakeMap() {
  const known = new Set<string>([...RASTER_IDS, 'dark-water', 'dark-greens', 'uae-places'])
  const map = {
    style: {},
    getLayer: vi.fn((id: string) => (known.has(id) ? { id } : undefined)),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  }
  return { map: map as unknown as maplibregl.Map, spies: map }
}

// The visibility the hook last set for each raster layer, in the order the
// calls actually happened.
function rasterVisibility(setLayoutProperty: ReturnType<typeof vi.fn>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const call of setLayoutProperty.mock.calls) {
    const [id, prop, value] = call as [string, string, string]
    if (prop === 'visibility' && (RASTER_IDS as readonly string[]).includes(id)) out[id] = value
  }
  return out
}

function renderPlannerBasemap() {
  const { map, spies } = makeFakeMap()
  const mapRef: MutableRefObject<maplibregl.Map | null> = { current: map }
  const view = renderHook(() => usePlannerBasemap(mapRef, true))
  return { view, spies }
}

describe('usePlannerBasemap', () => {
  const originalState = useAppStore.getState()

  beforeEach(() => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    delete document.documentElement.dataset.maplayer
  })

  afterEach(() => {
    // Auto-cleanup is active repo-wide now, but the explicit call is kept for
    // the same reason the rest of the suite keeps its own: it stays correct if
    // test.globals is ever reverted.
    cleanup()
    useAppStore.setState({
      scene: originalState.scene,
      layer: originalState.layer,
      offline: originalState.offline,
    })
    delete document.documentElement.dataset.maplayer
  })

  it("shows the SELECTED layer while scene is 'globe' (the deliberate divergence)", () => {
    // The planner has no globe scene, and the store's default scene IS
    // 'globe'. If someone "helpfully" routes this hook through
    // effectiveLayer(scene, layer), sat wins here and a user who lands on
    // /planner first gets satellite imagery whatever they picked. This test
    // exists to fail loudly if that happens.
    useAppStore.setState({ scene: 'globe', layer: 'light' })

    const { spies } = renderPlannerBasemap()

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(vis['raster-light']).toBe('visible')
    expect(vis['raster-sat']).toBe('none')
  })

  it('sets exactly one raster visible and the other three to none', () => {
    useAppStore.setState({ layer: 'terrain' })

    const { spies } = renderPlannerBasemap()

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(vis).toEqual({
      'raster-dark': 'none',
      'raster-light': 'none',
      'raster-sat': 'none',
      'raster-terrain': 'visible',
    })
    expect(Object.values(vis).filter((v) => v === 'visible')).toHaveLength(1)
  })

  it('shows no raster at all when offline', () => {
    useAppStore.setState({ layer: 'sat', offline: true })

    const { spies } = renderPlannerBasemap()

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(Object.values(vis)).toEqual(['none', 'none', 'none', 'none'])
  })

  it('stamps data-maplayer with the selected layer', () => {
    // Not cosmetic: shared/tokens.css keys --chrome off
    // :root[data-maplayer=...] and planner.css uses var(--chrome) throughout.
    useAppStore.setState({ layer: 'light' })

    renderPlannerBasemap()

    expect(document.documentElement.dataset.maplayer).toBe('light')
  })

  it('re-applies when the layer changes in the store', () => {
    useAppStore.setState({ layer: 'dark' })

    const { spies } = renderPlannerBasemap()
    expect(rasterVisibility(spies.setLayoutProperty)['raster-dark']).toBe('visible')

    spies.setLayoutProperty.mockClear()
    act(() => {
      useAppStore.getState().setLayer('sat')
    })

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(vis['raster-sat']).toBe('visible')
    expect(vis['raster-dark']).toBe('none')
    expect(document.documentElement.dataset.maplayer).toBe('sat')
  })
})
