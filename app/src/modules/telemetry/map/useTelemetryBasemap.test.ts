// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useTelemetryBasemap } from './useTelemetryBasemap'
import { useAppStore } from '@/shared/store'

const RASTER_IDS = ['raster-dark', 'raster-light', 'raster-sat', 'raster-terrain'] as const

// Same fake-map convention as usePlannerBasemap.test.ts: only the slice of
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

function rasterVisibility(setLayoutProperty: ReturnType<typeof vi.fn>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const call of setLayoutProperty.mock.calls) {
    const [id, prop, value] = call as [string, string, string]
    if (prop === 'visibility' && (RASTER_IDS as readonly string[]).includes(id)) out[id] = value
  }
  return out
}

function renderTelemetryBasemap() {
  const { map, spies } = makeFakeMap()
  const mapRef: MutableRefObject<maplibregl.Map | null> = { current: map }
  const view = renderHook(() => useTelemetryBasemap(mapRef, true))
  return { view, spies }
}

describe('useTelemetryBasemap', () => {
  const originalState = useAppStore.getState()

  beforeEach(() => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    delete document.documentElement.dataset.maplayer
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({
      scene: originalState.scene,
      layer: originalState.layer,
      offline: originalState.offline,
    })
    delete document.documentElement.dataset.maplayer
  })

  it("shows the SELECTED layer while scene is 'globe' (telemetry has no globe scene)", () => {
    // The store's default scene is 'globe' (the console's orbital boot
    // state), which telemetry never enters. If this hook were routed through
    // effectiveLayer(scene, layer) like the console's useBasemap, satellite
    // would win here no matter what the operator picked.
    useAppStore.setState({ scene: 'globe', layer: 'light' })

    const { spies } = renderTelemetryBasemap()

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(vis['raster-light']).toBe('visible')
    expect(vis['raster-sat']).toBe('none')
  })

  it('sets exactly one raster visible and the other three to none', () => {
    useAppStore.setState({ layer: 'terrain' })

    const { spies } = renderTelemetryBasemap()

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

    const { spies } = renderTelemetryBasemap()

    const vis = rasterVisibility(spies.setLayoutProperty)
    expect(Object.values(vis)).toEqual(['none', 'none', 'none', 'none'])
  })

  it('stamps data-maplayer with the selected layer', () => {
    useAppStore.setState({ layer: 'light' })

    renderTelemetryBasemap()

    expect(document.documentElement.dataset.maplayer).toBe('light')
  })

  it('re-applies when the layer changes in the store', () => {
    useAppStore.setState({ layer: 'dark' })

    const { spies } = renderTelemetryBasemap()
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

  it("retints uae-places' text for the pale rasters (light/terrain)", () => {
    useAppStore.setState({ layer: 'light' })

    const { spies } = renderTelemetryBasemap()

    expect(spies.setPaintProperty).toHaveBeenCalledWith('uae-places', 'text-color', '#3a404c')
  })
})
