// Ported (Phase 1E / Task 2) from assets/js/ui/control.js:126-196
// (control.enterManual / cleanupUI / control.exitManual) and :716-732
// (wireEngineWatch's MANUAL_RELEASED watch). control.js:88-124's waypoint
// layer helpers (waypointFeatures/refreshWaypoints/startWpPoll/stopWpPoll)
// are folded in here too, since they only exist to serve enterManual/
// exitManual's poll lifecycle.
//
// DESIGN NOTE: legacy's `control` object was a single page-lifetime
// singleton — one enterManual/exitManual pair, one banner element, one
// setInterval. This hook is instead called from more than one component
// (DroneTelemetryPanel here in Task 2; Console.tsx registers a second
// instance with selectEntity.ts's registerCaptureExits in Task 8) — so
// every piece of *shared* state (mode, active drone id, the follow-was-auto
// flag) lives in the Zustand store (shared/store.ts's Task 1 slice) rather
// than in a hook-local useState, exactly as the plan requires. Only the
// waypoint-poll interval handle is hook-instance-local (via useRef) — it is
// pure side-effect wiring, not state another component needs to read, and
// every call site's own copy is torn down on its own unmount (see the
// unmount-safety effect at the bottom), so redundant polling across
// multiple mounted instances is harmless (each just re-derives and
// re-writes the same `manual-wpts` source data).
//
// Engine/map access uses `useContext` directly against EngineContext/
// MapContext rather than the throwing useEngine()/useMap() accessors,
// mirroring panels/hooks.ts's useOptionalEngine/useOptionalMap (that file
// is out of this task's scope fence, so the same non-throwing pattern is
// reimplemented locally) — DroneTelemetryPanel is exercised in tests
// without a <MapView>/<EngineProvider> tree (see RightPanel.test.tsx,
// which renders it with `map={null}` and no map/engine providers mounted
// at all), and this hook must not throw when that happens.

import { useCallback, useContext, useEffect, useRef } from 'react'
import type { GeoJSONSource, Source } from 'maplibre-gl'
import type { SimEvent } from '@/modules/console/domain'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { MapContext } from '@/modules/console/map/MapContext'
import { useUpdater } from '@/modules/console/engine/UpdaterContext'
import { useAppStore } from '@/shared/store'
import { WP_POLL_MS, waypointFeatures } from './manualModel'

// panels.js:1660 via control.js:158 (control.enterManual's own easeTo,
// duplicated in DroneTelemetryPanel.tsx's own FOLLOW button handler and
// here — both are faithful ports of the same 12.5/600 pair legacy used at
// both call sites).
const FOLLOW_EASE_ZOOM = 12.5
const FOLLOW_EASE_DURATION_MS = 600

// Mirrors updateLiveLayers.ts's asGeoJSONSource narrowing (Phase 1C): a
// `Source` returned by `getSource()` doesn't carry `setData` in its public
// type (only `GeoJSONSource` does).
function asGeoJSONSource(source: Source | undefined): GeoJSONSource | null {
  return source && 'setData' in source ? (source as GeoJSONSource) : null
}

export interface UseManualControlResult {
  enterManual: (droneId: string) => boolean
  exitManual: () => void
}

export function useManualControl(): UseManualControlResult {
  const engineCtx = useContext(EngineContext)
  const mapCtx = useContext(MapContext)
  const updater = useUpdater()

  // Refs kept in sync every render so the stable (useCallback'd) functions
  // below always read the freshest context/updater values at call time —
  // matching legacy's module-scope closures, which read `window.__engine` /
  // `EC2.map` fresh on every call rather than capturing them once.
  const engineCtxRef = useRef(engineCtx)
  engineCtxRef.current = engineCtx
  const mapCtxRef = useRef(mapCtx)
  mapCtxRef.current = mapCtx
  const updaterRef = useRef(updater)
  updaterRef.current = updater

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getEngine = useCallback(() => engineCtxRef.current?.engineRef.current ?? null, [])
  const getMap = useCallback(() => mapCtxRef.current?.mapRef.current ?? null, [])
  // Map writes gate on useMap().ready, never map.loaded() (plan's global
  // constraint) — `ready` is read off the same MapContext value useMap()
  // itself reads, just via the non-throwing useContext above.
  const getMapReady = useCallback(() => mapCtxRef.current?.ready ?? false, [])

  // control.js:102-106 (refreshWaypoints).
  const refreshWaypoints = useCallback(() => {
    const map = getMap()
    if (!map || !getMapReady()) return
    const src = asGeoJSONSource(map.getSource('manual-wpts'))
    if (!src) return
    const { controlActiveId } = useAppStore.getState()
    src.setData(waypointFeatures(getEngine(), controlActiveId))
  }, [getEngine, getMap, getMapReady])

  // control.js:108-112 (clearWaypointLayer).
  const clearWaypointLayer = useCallback(() => {
    const map = getMap()
    if (!map || !getMapReady()) return
    const src = asGeoJSONSource(map.getSource('manual-wpts'))
    if (src) src.setData(waypointFeatures(null, null))
  }, [getMap, getMapReady])

  // control.js:122-124 (stopWpPoll).
  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // control.js:118-121 (startWpPoll).
  const startPoll = useCallback(() => {
    stopPoll()
    pollRef.current = setInterval(refreshWaypoints, WP_POLL_MS)
  }, [refreshWaypoints, stopPoll])

  // control.js:48-50 (setCursor).
  const setCursor = useCallback(
    (css: string) => {
      const map = getMap()
      if (map) map.getCanvas().style.cursor = css
    },
    [getMap],
  )

  // control.js:172-183 (cleanupUI). Shared UI teardown only — does NOT
  // touch engine state; callers (exitManual below, and the MANUAL_RELEASED
  // watch) decide whether the engine side also needs releasing.
  // hideBanner()/updateNewMissionButtonState() have no imperative
  // equivalent here: ManualBanner.tsx and chrome/Topbar.tsx (Task 1) both
  // already derive their rendering from `controlMode`/`controlActiveId`
  // reactively, so resetting those store fields is enough to update both.
  const cleanupUI = useCallback(() => {
    const { controlFollowWasAuto, setControlMode, setControlFollowWasAuto, setFollowDroneId } =
      useAppStore.getState()
    setControlMode('normal', null)
    setCursor('')
    stopPoll()
    clearWaypointLayer()
    updaterRef.current?.setRangeHighlight(null) // guarded: null before Console.tsx provides one (Task 8)
    if (controlFollowWasAuto) setFollowDroneId(null)
    setControlFollowWasAuto(false)
  }, [clearWaypointLayer, setCursor, stopPoll])

  // control.js:188-196 (control.exitManual). Explicit release path —
  // RELEASE button, ESC key (useCaptureKeys.ts), selecting another entity
  // (selectEntity.ts's registerCaptureExits), or GLOBE exit.
  const exitManual = useCallback((): void => {
    const { controlMode, controlActiveId } = useAppStore.getState()
    if (controlMode !== 'manual') return
    const engine = getEngine()
    if (engine && controlActiveId) {
      const drone = engine.drones.get(controlActiveId)
      if (drone && drone.state === 'manual') engine.setManual(controlActiveId, false)
    }
    cleanupUI()
  }, [cleanupUI, getEngine])

  // control.js:131-167 (control.enterManual).
  const enterManual = useCallback(
    (droneId: string): boolean => {
      const engine = getEngine()
      if (!engine) return false
      if (
        useAppStore.getState().controlMode === 'manual' &&
        useAppStore.getState().controlActiveId === droneId
      ) {
        return true
      }
      if (useAppStore.getState().controlMode === 'manual') exitManual()
      if (useAppStore.getState().controlMode === 'wizard') return false // one capture mode at a time

      const ok = engine.setManual(droneId, true)
      if (!ok) return false

      const { setControlMode, setControlFollowWasAuto, setFollowDroneId } = useAppStore.getState()
      setControlMode('manual', droneId)
      setCursor('crosshair')

      // Contract C-4: spotlight the home dock's coverage ring while the
      // operator flies. Guarded — null before Console.tsx provides a real
      // updater (Task 8).
      const drone = engine.drones.get(droneId)
      updaterRef.current?.setRangeHighlight(drone ? drone.dockId : null)

      if (useAppStore.getState().followDroneId !== droneId) {
        setFollowDroneId(droneId)
        setControlFollowWasAuto(true)
        const map = getMap()
        if (map && drone) {
          map.easeTo({
            center: drone.pos,
            zoom: FOLLOW_EASE_ZOOM,
            duration: FOLLOW_EASE_DURATION_MS,
          })
        }
      } else {
        setControlFollowWasAuto(false)
      }

      refreshWaypoints()
      startPoll()
      return true
    },
    [exitManual, getEngine, getMap, refreshWaypoints, setCursor, startPoll],
  )

  // control.js:716-732 (wireEngineWatch). A forced release (battery floor)
  // happens entirely inside the engine tick — this catches it via the
  // event feed so the banner/cursor/layer clear even if RELEASE was never
  // clicked. Idempotent with exitManual's own cleanup: both converge on the
  // same cleanupUI(). Structured `code: 'MANUAL_RELEASED'` (not a message
  // regex), matching domain/engine.ts's setManual.
  useEffect(() => {
    const engine = getEngine()
    if (!engine) return
    function onEngineEvent(ev: SimEvent): void {
      const { controlMode, controlActiveId } = useAppStore.getState()
      if (controlMode !== 'manual' || ev.source !== controlActiveId) return
      if (ev.code === 'MANUAL_RELEASED') cleanupUI()
    }
    engine.onEvent(onEngineEvent)
    return () => engine.offEvent(onEngineEvent)
    // engineCtx (not just getEngine, which is stable/memo'd with no deps)
    // is the dependency that actually re-runs this effect once the engine
    // becomes available after this hook's first render (EngineProvider
    // publishes a new context value once `started` flips true).
  }, [cleanupUI, engineCtx, getEngine])

  // Belt-and-suspenders unmount cleanup: control.js's poll never needed an
  // unmount path (the control object lived for the page's whole lifetime),
  // but a React component hosting this hook can unmount while manual
  // control is still engaged (e.g. torn down by something other than
  // RELEASE/ESC/selection-change). All timers live in an effect with
  // cleanup per the plan's global constraint.
  useEffect(() => stopPoll, [stopPoll])

  return { enterManual, exitManual }
}
