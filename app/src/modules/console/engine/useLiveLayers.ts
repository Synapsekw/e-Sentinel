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
// The ticker-push half of onEvent (main.js:57, `EC2.ui.pushEvent`) is a
// deliberate seam for Task 4: `pushTickerEvent` doesn't exist on the store
// yet. The mapped-event branch below is marked TODO and is a one-line call
// once Task 4 lands it — the subscription itself (attach once, detach on
// unmount) is built now so Task 4 doesn't need to touch this wiring.

import { useEffect, useRef } from 'react'
import { useEngine } from './EngineContext'
import { useMap } from '@/modules/console/map/MapContext'
import { useAppStore } from '@/shared/store'
import { createLiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import type { LiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import { pushLaunchPulse } from '@/modules/console/map/fx'
import { computeCounts } from './refreshCounts'

const STATS_INTERVAL_MS = 1000 // main.js:90's 1000ms refreshCounts throttle

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

  // Engine event subscription: ticker push (Task 4 seam) + launch FX pulse
  // (main.js:56-59). Attaches once the engine exists (guarded on `started`)
  // and detaches on unmount / engine identity change. `engine.onEvent`
  // (domain/engine.ts) has no separate unsubscribe return — it pushes the
  // callback onto `engine._subscribers` and hands the same callback back —
  // so cleanup removes it from that array by identity, same handle.
  useEffect(() => {
    const engine = engineRef.current
    if (!started || !engine) return

    const cb = engine.onEvent((ev) => {
      // TODO(Task 4): useAppStore.getState().pushTickerEvent(mapTickerEvent(ev))
      if (ev.code === 'MISSION_LAUNCHED' && ev.dockId) {
        pushLaunchPulse(ev.dockId, mapRef.current, useAppStore.getState().scene, ready)
      }
    })

    return () => {
      const idx = engine._subscribers.indexOf(cb)
      if (idx !== -1) engine._subscribers.splice(idx, 1)
    }
  }, [started, engineRef, mapRef, ready])

  // rAF render loop (main.js:87-96): keeps live map layers in sync with
  // engine state every frame, throttling the derived grid-stats push to
  // ~1 Hz. Only runs once the engine has started AND the map is ready —
  // mirrors legacy's implicit gating (EC2.updateLiveLayers / EC2.map both
  // needing to exist before startEngine's frame() loop could do anything).
  useEffect(() => {
    if (!started || !ready) return
    const engine = engineRef.current
    const map = mapRef.current
    if (!engine || !map) return

    const updater = updaterRef.current
    if (!updater) return

    let rafId = 0
    let lastStatsAt = 0

    function frame(ts: number): void {
      if (!engine || !map) return
      const { selection, followDroneId } = useAppStore.getState()
      // Non-null: guarded by the `if (!updater) return` above this closure's
      // definition — `updater` is a `const` that TS's closure analysis
      // doesn't re-narrow inside a nested function declaration.
      updater!.update(engine, map, selection, followDroneId, ready)
      if (ts - lastStatsAt > STATS_INTERVAL_MS) {
        lastStatsAt = ts
        useAppStore.getState().setStats(computeCounts(engine))
      }
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    return () => cancelAnimationFrame(rafId)
  }, [started, ready, engineRef, mapRef])
}
