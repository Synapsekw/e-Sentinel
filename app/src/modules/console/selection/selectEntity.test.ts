import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SimEngine, DATA_DOCKS, DATA_SITES, GEO_UAE } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { selectEntity, clearSelection, selectedDockId, inCaptureMode } from './selectEntity'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5)
  return e
}

// Returns a maplibre-gl Map stand-in alongside standalone references to its
// flyTo/easeTo mocks. Tests assert on `flyTo`/`easeTo` directly rather than
// `map.flyTo`/`map.easeTo` — reading a vi.fn() through a property typed via
// maplibre-gl's Map class (method-shorthand signatures) trips
// @typescript-eslint/unbound-method (it can't tell a mock apart from a real
// bound method), where a plain local variable holding the same mock doesn't
// (see useLiveLayers.test.tsx's createFakeUpdater for the same pattern).
function fakeMap(): {
  map: import('maplibre-gl').Map
  flyTo: ReturnType<typeof vi.fn>
  easeTo: ReturnType<typeof vi.fn>
} {
  const flyTo = vi.fn()
  const easeTo = vi.fn()
  const map = { flyTo, easeTo } as unknown as import('maplibre-gl').Map
  return { map, flyTo, easeTo }
}

describe('selectEntity', () => {
  beforeEach(() => {
    useAppStore.setState({
      selection: null,
      followDroneId: null,
      rightPanel: { mode: 'empty' },
    })
  })

  it('inCaptureMode is false until Phase 1E lands manual/wizard modes', () => {
    expect(inCaptureMode()).toBe(false)
  })

  it('selecting a dock sets selection + panel and flies the camera once', () => {
    const { map, flyTo } = fakeMap()
    const id = DATA_DOCKS[0].id
    selectEntity({ type: 'dock', id }, null, map)
    expect(useAppStore.getState().selection).toEqual({ type: 'dock', id })
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'dock', id })
    expect(flyTo).toHaveBeenCalledTimes(1)
    selectEntity({ type: 'dock', id }, null, map)
    expect(flyTo).toHaveBeenCalledTimes(1) // unchanged selection does not re-fly
  })

  it('ignores an unknown dock id', () => {
    const { map, flyTo } = fakeMap()
    selectEntity({ type: 'dock', id: 'NOPE-999' }, null, map)
    expect(useAppStore.getState().selection).toBe(null)
    expect(flyTo).not.toHaveBeenCalled()
  })

  it('selecting a live drone sets the panel and never moves the camera', () => {
    const engine = bootedEngine()
    const { map, flyTo, easeTo } = fakeMap()
    const drone = [...engine.drones.values()].find((d) => d.state !== 'docked')
    expect(drone).toBeTruthy()
    selectEntity({ type: 'drone', id: drone!.id }, engine, map)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'drone', id: drone!.id })
    expect(flyTo).not.toHaveBeenCalled()
    expect(easeTo).not.toHaveBeenCalled()
  })

  it('a drone selection needs an engine', () => {
    const { map } = fakeMap()
    selectEntity({ type: 'drone', id: 'D-AUH-01' }, null, map)
    expect(useAppStore.getState().selection).toBe(null)
  })

  it('selecting a site sets the site panel', () => {
    const { map } = fakeMap()
    const id = DATA_SITES[0].id
    selectEntity({ type: 'site', id }, null, map)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'site', id })
  })

  it('FOLLOW survives re-selecting the same drone but not a different entity', () => {
    const engine = bootedEngine()
    const { map } = fakeMap()
    const drone = [...engine.drones.values()].find((d) => d.state !== 'docked')!
    useAppStore.setState({ followDroneId: drone.id })
    selectEntity({ type: 'drone', id: drone.id }, engine, map)
    expect(useAppStore.getState().followDroneId).toBe(drone.id)
    selectEntity({ type: 'dock', id: DATA_DOCKS[0].id }, engine, map)
    expect(useAppStore.getState().followDroneId).toBe(null)
  })

  it('clearSelection resets selection, follow and the panel', () => {
    useAppStore.setState({
      selection: { type: 'dock', id: DATA_DOCKS[0].id },
      followDroneId: 'D-X',
      rightPanel: { mode: 'dock', id: DATA_DOCKS[0].id },
    })
    clearSelection()
    expect(useAppStore.getState().selection).toBe(null)
    expect(useAppStore.getState().followDroneId).toBe(null)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'empty' })
  })

  it('selectedDockId maps a drone selection back to its dock row', () => {
    expect(selectedDockId(null)).toBe(null)
    expect(selectedDockId({ type: 'dock', id: 'AUH-01' })).toBe('AUH-01')
    expect(selectedDockId({ type: 'drone', id: 'D-AUH-01' })).toBe('AUH-01')
    expect(selectedDockId({ type: 'site', id: 'S-01' })).toBe(null)
  })
})
