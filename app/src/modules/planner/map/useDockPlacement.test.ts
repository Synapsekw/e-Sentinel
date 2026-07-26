// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { dockFromClick, useDockPlacement } from './useDockPlacement'
import { PLANNER_SOURCES } from './plannerStyle'
import { resetIdsForTest, createPlan, addDock } from '../domain/plan'
import { usePlanStore } from '../store/planStore'
import type { PlannedDock } from '../domain/types'

describe('dockFromClick', () => {
  beforeEach(() => resetIdsForTest())

  it('creates a manual dock at the clicked position', () => {
    const d = dockFromClick({ lng: 54.6, lat: 24.3 }, 1)
    expect(d.position).toEqual([54.6, 24.3])
    expect(d.source).toBe('manual')
    expect(d.name).toBe('DOCK 01')
  })

  it('auto-detects urban placement from the position', () => {
    // Abu Dhabi Corniche is inside an URBAN_CENTERS circle in the sim's
    // dock range model, so a dock dropped there defaults to urban (3km).
    const d = dockFromClick({ lng: 54.349, lat: 24.477 }, 1)
    expect(d.environment).toBe('urban')
  })

  it('defaults to rural in open desert', () => {
    const d = dockFromClick({ lng: 53.0, lat: 23.2 }, 1)
    expect(d.environment).toBe('rural')
  })

  it('zero-pads the sequence in the generated name', () => {
    expect(dockFromClick({ lng: 54.6, lat: 24.3 }, 12).name).toBe('DOCK 12')
  })
})

// ---- fake map harness for the hook-level (drag/placement) tests ----
// The real maplibregl.Map needs a live WebGL canvas, which this repo's other
// hook tests avoid by faking only the slice of the API actually called (see
// useAoiDraw.test.ts's `{ style: {} } as unknown as maplibregl.Map`). This
// hook calls on/off, queryRenderedFeatures, getSource, and dragPan.enable/
// disable, plus reads `style` via isMapUsable -- nothing else, so the fake
// only needs to implement that slice.
type Handler = (e: unknown) => void

function makeFakeMap() {
  const handlers = new Map<string, Set<Handler>>()
  const docksSetData = vi.fn()
  const ringsSetData = vi.fn()
  const queryRenderedFeatures = vi.fn().mockReturnValue([])
  const dragPanEnable = vi.fn()
  const dragPanDisable = vi.fn()
  const sources: Record<string, { setData: typeof docksSetData } | undefined> = {
    [PLANNER_SOURCES.docks]: { setData: docksSetData },
    [PLANNER_SOURCES.rings]: { setData: ringsSetData },
  }

  const mapLike = {
    style: {}, // isMapUsable() probe: present => alive
    dragPan: { enable: dragPanEnable, disable: dragPanDisable },
    queryRenderedFeatures,
    getSource: vi.fn((id: string) => sources[id]),
    on: vi.fn((type: string, cb: Handler) => {
      const set = handlers.get(type) ?? new Set<Handler>()
      set.add(cb)
      handlers.set(type, set)
    }),
    off: vi.fn((type: string, cb: Handler) => {
      handlers.get(type)?.delete(cb)
    }),
  }

  function fire(type: string, e: unknown): void {
    handlers.get(type)?.forEach((h) => h(e))
  }

  return {
    // One cast, here: mapLike implements only the handful of members this
    // hook actually touches, not the full maplibregl.Map surface.
    map: mapLike as unknown as maplibregl.Map,
    fire,
    queryRenderedFeatures,
    docksSetData,
    ringsSetData,
    dragPanEnable,
    dragPanDisable,
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

// Captured before any test spies on a store action, so beforeEach can
// restore pristine (unspied) action references every run (matches
// useCoverageDriver.test.ts's pattern).
const pristineStoreState = usePlanStore.getState()

describe('useDockPlacement drag', () => {
  let fakeMap: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    resetIdsForTest()
    fakeMap = makeFakeMap()
    mapRef = { current: fakeMap.map }
    usePlanStore.setState({
      ...pristineStoreState,
      plan: addDock(createPlan(), DOCK),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
  })

  afterEach(() => {
    // vite.config.ts now sets test.globals: true, so @testing-library/react's
    // auto-cleanup DOES register; this explicit cleanup() is kept anyway
    // because it is idempotent and does not depend on that flag (see
    // useCoverageDriver.test.ts).
    cleanup()
    vi.restoreAllMocks()
  })

  it('commits to the store exactly once across mousedown/mousemove/mousemove/mouseup', () => {
    // This is the load-bearing assertion for the task's performance rule:
    // committing on every mousemove would re-render every panel and rebuild
    // every ring buffer per frame. Two mousemoves must produce ONE commit.
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')

    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [1, 0], lngLat: { lng: 54.65, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [2, 0], lngLat: { lng: 54.7, lat: 24.3 } })
    fakeMap.fire('mouseup', { point: [2, 0], lngLat: { lng: 54.7, lat: 24.3 } })

    expect(setPlanSpy).toHaveBeenCalledOnce()
    expect(usePlanStore.getState().plan.docks[0].position).toEqual([54.7, 24.3])
  })

  it('feeds the dock and ring sources imperatively on every mousemove, without touching the store', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')

    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [1, 0], lngLat: { lng: 54.65, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [2, 0], lngLat: { lng: 54.7, lat: 24.3 } })

    expect(fakeMap.docksSetData).toHaveBeenCalledTimes(2)
    expect(fakeMap.ringsSetData).toHaveBeenCalledTimes(2)
    expect(setPlanSpy).not.toHaveBeenCalled()
  })

  it('disables dragPan on mousedown and re-enables it on mouseup', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    expect(fakeMap.dragPanDisable).toHaveBeenCalledOnce()
    expect(fakeMap.dragPanEnable).not.toHaveBeenCalled()

    fakeMap.fire('mouseup', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    expect(fakeMap.dragPanEnable).toHaveBeenCalledOnce()
  })

  it('a mousedown that misses every dock does not start a drag', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')
    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 10, lat: 10 } })
    fakeMap.fire('mousemove', { point: [1, 0], lngLat: { lng: 11, lat: 10 } })
    fakeMap.fire('mouseup', { point: [1, 0], lngLat: { lng: 11, lat: 10 } })

    expect(setPlanSpy).not.toHaveBeenCalled()
    expect(fakeMap.dragPanDisable).not.toHaveBeenCalled()
  })

  it('commits at the last tracked position when the button is released outside the canvas', () => {
    // MapLibre's own canvas-scoped 'mouseup' only fires for a release that
    // lands back on the canvas. Simulate a release outside it by ending the
    // gesture with a real window 'mouseup' DOM event instead of
    // fakeMap.fire('mouseup', ...) -- the fake map's own mouseup handler is
    // never invoked here, only the hook's window-level fallback is.
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')
    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [1, 0], lngLat: { lng: 54.9, lat: 24.5 } })

    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(setPlanSpy).toHaveBeenCalledOnce()
    expect(usePlanStore.getState().plan.docks[0].position).toEqual([54.9, 24.5])
    expect(fakeMap.dragPanEnable).toHaveBeenCalledOnce()
  })

  it('ends the drag on window blur so dragPan does not stay disabled forever', () => {
    // Covers alt-tabbing away mid-drag: the eventual mouseup happens in a
    // different window/app and neither the map's nor the window's mouseup
    // listener here would ever see it.
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    window.dispatchEvent(new Event('blur'))

    expect(fakeMap.dragPanEnable).toHaveBeenCalledOnce()
  })

  it('removes its window-level listeners on unmount: a later mouseup does nothing', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')
    const { unmount } = renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    unmount()
    window.dispatchEvent(new MouseEvent('mouseup'))

    // Unmounting mid-drag must not leave the map permanently unpannable:
    // nothing else will ever call .enable() on this instance again once
    // the cleanup has run. The unmount discards the in-progress move
    // rather than committing it (setPlan is still never called) -- an
    // unmount is not the same intent as the user releasing the mouse.
    expect(fakeMap.dragPanEnable).toHaveBeenCalledOnce()
    expect(setPlanSpy).not.toHaveBeenCalled()
  })

  it('does not start a drag while a draw mode is active (Important 5)', () => {
    // Regression: with DRAW · POLYGON active, a vertex click landing on an
    // existing dock marker used to start a dock drag (this same
    // queryRenderedFeatures/DOCK_LAYER_ID probe) while terra-draw was
    // simultaneously consuming the same clicks as polygon vertices.
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const setPlanSpy = vi.spyOn(usePlanStore.getState(), 'setPlan')
    renderHook(() => useDockPlacement(mapRef, true, false))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    fakeMap.fire('mousemove', { point: [1, 0], lngLat: { lng: 54.7, lat: 24.3 } })
    fakeMap.fire('mouseup', { point: [1, 0], lngLat: { lng: 54.7, lat: 24.3 } })

    expect(fakeMap.dragPanDisable).not.toHaveBeenCalled()
    expect(setPlanSpy).not.toHaveBeenCalled()
  })

  it('resumes dragging once the draw mode returns to idle', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const { rerender } = renderHook(({ idle }) => useDockPlacement(mapRef, true, idle), {
      initialProps: { idle: false },
    })

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    expect(fakeMap.dragPanDisable).not.toHaveBeenCalled()

    rerender({ idle: true })
    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    expect(fakeMap.dragPanDisable).toHaveBeenCalledOnce()
  })

  it('does not touch dragPan or throw when cleanup runs mid-drag against an already torn-down map', () => {
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const { unmount } = renderHook(() => useDockPlacement(mapRef, true))

    fakeMap.fire('mousedown', { point: [0, 0], lngLat: { lng: 54.6, lat: 24.3 } })
    expect(fakeMap.dragPanDisable).toHaveBeenCalledOnce()

    // Simulate MapView's parent cleanup (map.remove()) having already run
    // before this hook's cleanup, same as isMapUsable's other callers --
    // MapLibre's remove() nulls the internal Style this probes for.
    // One cast: mutating a field the public maplibregl.Map type doesn't
    // expose is exactly what isMapUsable itself does internally.
    delete (fakeMap.map as unknown as { style?: unknown }).style

    expect(() => unmount()).not.toThrow()
    expect(fakeMap.dragPanEnable).not.toHaveBeenCalled()
  })
})

describe('useDockPlacement placement mode', () => {
  let fakeMap: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    resetIdsForTest()
    fakeMap = makeFakeMap()
    mapRef = { current: fakeMap.map }
    usePlanStore.setState({
      ...pristineStoreState,
      plan: createPlan(),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('adds a dock on the next map click after startPlacing, then stands down', () => {
    const { result } = renderHook(() => useDockPlacement(mapRef, true))

    act(() => result.current.startPlacing())
    expect(result.current.placing).toBe(true)

    act(() => {
      fakeMap.fire('click', { lngLat: { lng: 54.6, lat: 24.3 } })
    })

    expect(usePlanStore.getState().plan.docks).toHaveLength(1)
    expect(result.current.placing).toBe(false)
  })

  it('stands down on Escape without adding a dock', () => {
    const { result } = renderHook(() => useDockPlacement(mapRef, true))

    act(() => result.current.startPlacing())
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.placing).toBe(false)
    expect(usePlanStore.getState().plan.docks).toHaveLength(0)
  })

  it('a map click while not placing does nothing', () => {
    renderHook(() => useDockPlacement(mapRef, true))

    act(() => {
      fakeMap.fire('click', { lngLat: { lng: 54.6, lat: 24.3 } })
    })

    expect(usePlanStore.getState().plan.docks).toHaveLength(0)
  })

  it('does not add a dock on a map click while a draw mode is active (Minor 6)', () => {
    // Regression: with `+ DOCK` armed AND `DRAW * POLYGON` selected, a
    // single map click used to both add a dock here (this effect was not
    // gated on drawModeIdle, unlike the drag effect Important 5 already
    // fixed) and place a polygon vertex via terra-draw.
    const { result, rerender } = renderHook(({ idle }) => useDockPlacement(mapRef, true, idle), {
      initialProps: { idle: false },
    })

    act(() => result.current.startPlacing())
    act(() => {
      fakeMap.fire('click', { lngLat: { lng: 54.6, lat: 24.3 } })
    })

    expect(usePlanStore.getState().plan.docks).toHaveLength(0)
    // Placement stays armed while gated -- a draw mode being active does not
    // itself stand placement down (that mutual-exclusion decision belongs to
    // ui/Planner.tsx, which owns both drawMode and this hook); it just stops
    // an ungated click from silently doing both things at once.
    expect(result.current.placing).toBe(true)

    rerender({ idle: true })
    act(() => {
      fakeMap.fire('click', { lngLat: { lng: 54.6, lat: 24.3 } })
    })
    expect(usePlanStore.getState().plan.docks).toHaveLength(1)
    expect(result.current.placing).toBe(false)
  })

  it('a placement click landing on an existing dock marker neither adds a dock nor stands placement down', () => {
    // Regression for the carried double-commit nuisance: clicking an
    // existing dock while placement mode is armed used to fire both the
    // drag effect's (possibly no-op) position commit AND this addDock, for
    // one perceived click. queryRenderedFeatures returning a hit here is
    // exactly what a click landing on the DOCK_LAYER_ID marker looks like.
    fakeMap.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'existing' } }])
    const { result } = renderHook(() => useDockPlacement(mapRef, true))

    act(() => result.current.startPlacing())
    act(() => {
      fakeMap.fire('click', { point: [5, 5], lngLat: { lng: 54.6, lat: 24.3 } })
    })

    expect(usePlanStore.getState().plan.docks).toHaveLength(0)
    // Placement stays armed -- this was a miss, not a use of the click, so
    // the user should be able to just click again on open ground.
    expect(result.current.placing).toBe(true)
  })
})
