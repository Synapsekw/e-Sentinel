// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { usePlannerSelection } from './usePlannerSelection'
import { resetIdsForTest, createPlan, addDock } from '../domain/plan'
import { usePlanStore } from '../store/planStore'
import type { PlannedDock } from '../domain/types'

// Layer-scoped handlers: unlike useDockPlacement's fake map, this hook calls
// the 3-arg map.on(type, layerId, cb) form, so handlers are keyed by
// "type:layerId". A bare 2-arg on() (the plain map click that clears
// selection) is keyed by type alone.
type Handler = (e: unknown) => void

function makeFakeMap() {
  const handlers = new Map<string, Set<Handler>>()
  const canvas = { style: { cursor: '' } }
  const queryRenderedFeatures = vi.fn().mockReturnValue([])

  function key(type: string, layer?: string): string {
    return layer ? `${type}:${layer}` : type
  }

  const mapLike = {
    style: {},
    queryRenderedFeatures,
    getLayer: vi.fn((id: string) => ({ id })),
    getCanvas: () => canvas,
    on: vi.fn((type: string, a: string | Handler, b?: Handler) => {
      const layer = typeof a === 'string' ? a : undefined
      const cb = (typeof a === 'string' ? b : a) as Handler
      const k = key(type, layer)
      const set = handlers.get(k) ?? new Set<Handler>()
      set.add(cb)
      handlers.set(k, set)
    }),
    off: vi.fn((type: string, a: string | Handler, b?: Handler) => {
      const layer = typeof a === 'string' ? a : undefined
      const cb = (typeof a === 'string' ? b : a) as Handler
      handlers.get(key(type, layer))?.delete(cb)
    }),
  }

  return {
    map: mapLike as unknown as maplibregl.Map,
    canvas,
    queryRenderedFeatures,
    on: mapLike.on,
    off: mapLike.off,
    fire(type: string, layer: string | undefined, e: unknown) {
      handlers.get(key(type, layer))?.forEach((h) => h(e))
    },
    handlerCount(): number {
      let n = 0
      for (const set of handlers.values()) n += set.size
      return n
    },
  }
}

const DOCK: PlannedDock = {
  id: 'dock-1',
  name: 'DOCK 01',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural',
  source: 'manual',
}

const pristineStoreState = usePlanStore.getState()

describe('usePlannerSelection', () => {
  let fake: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    resetIdsForTest()
    fake = makeFakeMap()
    mapRef = { current: fake.map }
    usePlanStore.setState({
      ...pristineStoreState,
      plan: addDock(createPlan(), DOCK),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('selects a dock when its marker is clicked', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-docks-circle', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('selects a dock when its coverage ring is clicked, as the console does', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-rings-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('selects an area when its fill is clicked', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-aoi-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'aoi-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'aoi', id: 'aoi-1' })
  })

  it('lets a dock marker win over the ring beneath it', () => {
    // The ring handler must stand down when the click also landed on a marker,
    // or the two fire for one click. Mirrors useMapSelection's onCoverageClick.
    fake.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const selectSpy = vi.spyOn(usePlanStore.getState(), 'select')
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-rings-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('clears the selection when bare map is clicked', () => {
    usePlanStore.setState({ selection: { type: 'dock', id: 'dock-1' } })
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', undefined, { point: [500, 500] })
    })
    expect(usePlanStore.getState().selection).toBeNull()
  })

  it('does not clear when the bare-map click landed on a planner feature', () => {
    usePlanStore.setState({ selection: { type: 'dock', id: 'dock-1' } })
    fake.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', undefined, { point: [10, 10] })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('shows a pointer cursor over a dock and restores it on leave', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => fake.fire('mouseenter', 'planner-docks-circle', {}))
    expect(fake.canvas.style.cursor).toBe('pointer')
    act(() => fake.fire('mouseleave', 'planner-docks-circle', {}))
    expect(fake.canvas.style.cursor).toBe('')
  })

  it('does not select on the click that ends a drag which actually moved', () => {
    // useDockPlacement commits a drag on mouseup, and MapLibre fires a click
    // after it. Selecting there would fight the drag.
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('mousedown', undefined, { point: { x: 10, y: 10 } })
      fake.fire('mouseup', undefined, { point: { x: 40, y: 40 } })
      fake.fire('click', 'planner-docks-circle', {
        point: [40, 40],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toBeNull()
  })

  it('does select on a click with no movement, which is a plain click not a drag', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('mousedown', undefined, { point: { x: 10, y: 10 } })
      fake.fire('mouseup', undefined, { point: { x: 11, y: 10 } })
      fake.fire('click', 'planner-docks-circle', {
        point: [11, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('does not let a right-button drag (dragRotate) suppress the next real left-click', () => {
    // MapLibre's dragRotate is a right-button drag, and no `click` event ever
    // follows a rotate gesture to consume the suppression latch. An unguarded
    // latch armed by that drag would silently eat the user's next genuine
    // left-click on a dock, ring, or bare map.
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('mousedown', undefined, { point: { x: 10, y: 10 }, originalEvent: { button: 2 } })
      fake.fire('mouseup', undefined, { point: { x: 40, y: 40 }, originalEvent: { button: 2 } })
      fake.fire('click', 'planner-docks-circle', {
        point: [40, 40],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('registers nothing at all while disabled', () => {
    renderHook(() => usePlannerSelection(mapRef, true, false))
    expect(fake.handlerCount()).toBe(0)
  })

  it('removes every listener it registered on unmount', () => {
    const { unmount } = renderHook(() => usePlannerSelection(mapRef, true, true))
    expect(fake.handlerCount()).toBeGreaterThan(0)
    unmount()
    expect(fake.handlerCount()).toBe(0)
  })

  it('does not throw when cleanup runs against an already torn-down map', () => {
    const { unmount } = renderHook(() => usePlannerSelection(mapRef, true, true))
    // MapLibre's remove() nulls the internal Style isMapUsable probes for.
    delete (fake.map as unknown as { style?: unknown }).style
    expect(() => unmount()).not.toThrow()
  })
})
