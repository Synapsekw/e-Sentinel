import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { DOCK_RANGE } from '@/modules/console/domain'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { PLANNER_SOURCES, dockFeatures, ringFeatures } from './plannerStyle'
import { addDock, nextId, updateDock } from '../domain/plan'
import { usePlanStore } from '../store/planStore'
import type { PlannedDock } from '../domain/types'

// Minimal shape read off a click/mousedown's lngLat. dockFromClick's own
// tests pass a plain {lng,lat} literal; maplibregl's real LngLat class is a
// structural superset of it, so both satisfy this without coupling the pure
// helper to the maplibre-gl type.
type LngLatLike = { lng: number; lat: number }

export function dockFromClick(lngLat: LngLatLike, seq: number): PlannedDock {
  const coords: [number, number] = [lngLat.lng, lngLat.lat]
  return {
    id: nextId('dock'),
    name: `DOCK ${String(seq).padStart(2, '0')}`,
    position: coords,
    dockModel: 'DOCK3',
    droneModel: 'M4TD',
    // Reuse the simulation's own urban-centre model so a planner ring matches
    // a console ring for the same location.
    environment: DOCK_RANGE.isUrbanDock({ coords }) ? 'urban' : 'rural',
    source: 'manual',
  }
}

export interface DockPlacement {
  placing: boolean
  startPlacing(): void
  cancel(): void
}

// plannerStyle.ts inlines this id in its layers array rather than exporting
// a named constant (only its source ids are centralized in PLANNER_SOURCES).
const DOCK_LAYER_ID = 'planner-docks-circle'

export function useDockPlacement(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
): DockPlacement {
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(placing)
  placingRef.current = placing

  // Click-to-place. Stands down on Escape, matching the console's capture-
  // mode convention (useCaptureMapClicks / useWizard).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!placingRef.current) return
      // Called directly off getState() (not destructured): PlanState
      // declares its setters with method-shorthand signatures, so pulling
      // setPlan out into its own binding trips
      // @typescript-eslint/unbound-method (see useCoverageDriver.ts for the
      // same pattern).
      const state = usePlanStore.getState()
      state.setPlan(addDock(state.plan, dockFromClick(e.lngLat, state.plan.docks.length + 1)))
      setPlacing(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacing(false)
    }

    map.on('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Reference the captured `map`, not mapRef.current: MapView's cleanup
      // (parent, runs first on route navigation) sets mapRef.current to
      // null before this cleanup runs, so re-reading the ref here would
      // only ever see null and never the live-vs-removed distinction
      // isMapUsable is for. The captured instance itself gets its internal
      // Style nulled by map.remove(), which is what isMapUsable actually
      // detects (same reasoning as useAoiDraw.ts's teardownDraw).
      if (isMapUsable(map)) map.off('click', onClick)
    }
  }, [mapRef, ready])

  // Drag. The store is NOT touched until the gesture ends: committing per
  // mousemove would re-render every panel and rebuild all N ring buffers on
  // each frame, which visibly stutters once a plan has tens of docks.
  // During the drag the dock and ring sources are fed directly instead, so
  // the map still tracks the cursor at full rate, and exactly one commit
  // happens for the whole gesture (one rev bump, one debounced coverage
  // recompute via useCoverageDriver).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    let dragId: string | null = null
    let lastLngLat: LngLatLike | null = null

    // The single commit point, reachable from every path a drag can end on
    // (see the window-level fallbacks below). Guarded by dragId so a second
    // call observing an already-finished gesture is a no-op, not a double
    // commit.
    const endDrag = (lngLat: LngLatLike | null) => {
      if (!dragId) return
      if (lngLat) {
        const state = usePlanStore.getState()
        state.setPlan(updateDock(state.plan, dragId, { position: [lngLat.lng, lngLat.lat] }))
      }
      dragId = null
      lastLngLat = null
      map.dragPan.enable()
    }

    const onDown = (e: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: [DOCK_LAYER_ID] })[0]
      if (!hit) return
      dragId = String(hit.properties.id ?? '')
      lastLngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      map.dragPan.disable()
    }

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (!dragId) return
      lastLngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      // Imperative preview only: build the moved plan, push its geometry to
      // the map, and throw it away. Nothing enters React state.
      const preview = updateDock(usePlanStore.getState().plan, dragId, {
        position: [lastLngLat.lng, lastLngLat.lat],
      })
      map.getSource<GeoJSONSource>(PLANNER_SOURCES.docks)?.setData(dockFeatures(preview))
      map.getSource<GeoJSONSource>(PLANNER_SOURCES.rings)?.setData(ringFeatures(preview))
    }

    const onUp = (e: maplibregl.MapMouseEvent) => endDrag({ lng: e.lngLat.lng, lat: e.lngLat.lat })

    // MapLibre only fires its own canvas-scoped 'mouseup' when the release
    // lands back on the map canvas -- never for a button-up elsewhere on the
    // page. (MapLibre's own HandlerManager works around this same gap for
    // its built-in handlers, like dragPan/dragRotate, by ALSO listening on
    // `window` -- specifically so a drag they own can't get stuck if the
    // release happens off-canvas.) Without a fallback here, dragging a dock
    // past the canvas edge and releasing would leave dragId set forever:
    // dragPan would stay disabled, and the moved position would never reach
    // the store -- the next unrelated plan edit would silently snap the
    // dock back to its pre-drag position via usePlannerLayers, discarding
    // the whole gesture with no visible error. There is no map to project an
    // off-canvas release point against, so this finalizes with the last
    // position tracked while the cursor was still over the canvas.
    const onWindowUp = () => endDrag(lastLngLat)
    // A window blur (e.g. alt-tabbing away while the button is still down)
    // means the eventual mouseup happens in a different window/app and
    // neither listener above will ever see it. End the drag defensively
    // rather than leaving dragPan disabled indefinitely.
    const onBlur = () => endDrag(lastLngLat)

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    window.addEventListener('mouseup', onWindowUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mouseup', onWindowUp)
      window.removeEventListener('blur', onBlur)
      // Captured `map`, not mapRef.current -- see the click effect above.
      if (!isMapUsable(map)) return
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
    }
  }, [mapRef, ready])

  const startPlacing = useCallback(() => setPlacing(true), [])
  const cancel = useCallback(() => setPlacing(false), [])
  return { placing, startPlacing, cancel }
}
