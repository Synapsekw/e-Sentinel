// Ported (Phase 1C / Task 3) from assets/js/main.js:87-96 (startEngine's rAF
// render loop) and :56-59 (engine.onEvent's ticker push + launch-pulse
// wiring). Legacy's rAF frame() and the onEvent subscription both lived
// inside startEngine(), right beside the engine instance itself
// (window.__engine), so both naturally had the map (EC2.map) on hand.
//
// CONTROLLER DECISION (see EngineProvider.tsx): the engine now lives in a
// provider mounted above the router, which has no map access. Rather than
// splitting the render loop and the event subscription across two homes,
// both live here, in one hook called from inside the map subtree (where
// useEngine() + useMap() + the store's `scene` all resolve) — this is the
// "small hook called where both resolve" option named in the Task 3 brief's
// controller note, folded into useLiveLayers() itself rather than a
// separate file, since both concerns need the identical engine+map+ready
// inputs and the brief's file list only calls for this one hook.
//
// The ticker-push half of onEvent (main.js:57, `EC2.ui.pushEvent`) moved to
// EngineProvider.tsx's `attachTickerPush` in Phase 1D / Task 8: it needs
// neither the map nor `ready`, so subscribing there (above the router,
// where the engine lives for the app's whole lifetime) lets ticker events
// accumulate even while the user is on another route. Only the
// MISSION_LAUNCHED -> pushLaunchPulse branch stays here, since it needs the
// map.
//
// TASK 4 EXTRA (test coverage): the event subscription and the rAF render
// loop are pulled out into `attachEngineEvents` / `startRenderLoop` below —
// plain functions taking their engine/map/updater/ready inputs explicitly
// instead of closing over hook-internal refs — so the render-loop test
// (useLiveLayers.test.tsx) can drive them directly with a fake engine/map/
// updater and a stubbed rAF, without needing a real MapLibre instance or a
// React harness wired through EngineProvider+MapView. useLiveLayers() itself
// is now just two effects that resolve the real engine/map/updater and hand
// them to these functions — no behavior changed, only where the logic lives.

import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Engine } from '@/modules/console/domain'
import { useEngine } from './EngineContext'
import { useMap } from '@/modules/console/map/MapContext'
import { useAppStore } from '@/shared/store'
import { createLiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import type { LiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import { pushLaunchPulse } from '@/modules/console/map/fx'
import { computeCounts } from './refreshCounts'

export const STATS_INTERVAL_MS = 1000 // main.js:90's 1000ms refreshCounts throttle

// Engine event subscription: launch FX pulse only (main.js:56-59's other
// half, the ticker push, now lives in EngineProvider.tsx's attachTickerPush
// — see this file's header comment). `engine.onEvent` (domain/engine.ts)
// hands back the same callback it was given, which the returned cleanup
// passes to `engine.offEvent` to remove it by identity.
export function attachEngineEvents(
  engine: Engine,
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
): () => void {
  const cb = engine.onEvent((ev) => {
    if (ev.code === 'MISSION_LAUNCHED' && ev.dockId) {
      pushLaunchPulse(ev.dockId, mapRef.current, useAppStore.getState().scene, ready)
    }
  })

  return () => engine.offEvent(cb)
}

// rAF render loop (main.js:87-96): keeps live map layers in sync with engine
// state every frame, throttling the derived grid-stats push to ~1 Hz.
// Returns a cleanup that cancels the pending frame.
export function startRenderLoop(
  engine: Engine,
  map: maplibregl.Map,
  updater: LiveLayerUpdater,
  ready: boolean,
  statsIntervalMs: number = STATS_INTERVAL_MS,
): () => void {
  let rafId = 0
  let lastStatsAt = 0

  function frame(ts: number): void {
    const { selection, followDroneId } = useAppStore.getState()
    updater.update(engine, map, selection, followDroneId, ready)
    if (ts - lastStatsAt > statsIntervalMs) {
      lastStatsAt = ts
      useAppStore.getState().setStats(computeCounts(engine))
    }
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)

  return () => cancelAnimationFrame(rafId)
}

export function useLiveLayers(): void {
  const { engineRef, started } = useEngine()
  const { mapRef, ready } = useMap()

  // Single updater instance for this hook's lifetime (mirrors
  // updateLiveLayers.ts's closure-per-mount design) — lazily created once
  // via the `if (!ref.current)` guard rather than `useRef(createLiveLayerUpdater())`,
  // so a re-render never evaluates (and immediately discards) a second
  // TrailStore/closure.
  const updaterRef = useRef<LiveLayerUpdater | null>(null)
  if (!updaterRef.current) updaterRef.current = createLiveLayerUpdater()

  // Attaches once the engine exists (guarded on `started`) and detaches on
  // unmount / engine identity change.
  useEffect(() => {
    const engine = engineRef.current
    if (!started || !engine) return
    return attachEngineEvents(engine, mapRef, ready)
  }, [started, engineRef, mapRef, ready])

  // Only runs once the engine has started AND the map is ready — mirrors
  // legacy's implicit gating (EC2.updateLiveLayers / EC2.map both needing to
  // exist before startEngine's frame() loop could do anything).
  useEffect(() => {
    if (!started || !ready) return
    const engine = engineRef.current
    const map = mapRef.current
    const updater = updaterRef.current
    if (!engine || !map || !updater) return

    return startRenderLoop(engine, map, updater, ready)
  }, [started, ready, engineRef, mapRef])
}
