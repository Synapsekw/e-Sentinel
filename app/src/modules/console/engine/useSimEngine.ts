// Ported (Phase 1C / Task 1) from assets/js/main.js:11-15 (EC2.onSceneChange
// gating the one-time engine boot: "the first time the console scene is
// entered ... then leave it running") and :61-85 (startEngine's tick loop —
// a setInterval + wall-clock accumulator + fixed sub-step drain, plus a
// visibilitychange clamp so a suspended timer's backlog doesn't jump on
// resume). Legacy attached the single engine instance to `window.__engine`;
// here it lives in a ref owned by this hook and is exposed via
// EngineContext so descendants (Task 3's event/render wiring, later panels)
// can reach it without a global.
//
// Reacting to the store's `scene` field via `useAppStore.subscribe` (rather
// than taking `scene` as a reactive hook value / effect dependency) mirrors
// this codebase's established pattern for store-driven side effects outside
// React's render cycle (see useGlobe.ts's beacon-visibility subscription and
// useOffline.ts's offline-flag subscription) — it keeps engine creation a
// mount-once concern, immune to the effect re-running on every scene flip.
//
// Sim ticking intentionally runs off setInterval + performance.now(), not
// rAF: browsers throttle/suspend rAF in background tabs, which would freeze
// sim time exactly when a projector/tab-switch handoff needs it to keep
// running. rAF-driven rendering (Task 3) may pause harmlessly; this timer
// must not.

import { useEffect, useRef, useState } from 'react'
import type { Engine } from '@/modules/console/domain'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import type { EngineContextValue } from './EngineContext'
import { absorbWallTime, drainBacklog, SUB_STEP, MAX_BACKLOG, TICK_MS } from './simClock'

export function useSimEngine(): EngineContextValue {
  const engineRef = useRef<Engine | null>(null)
  const [started, setStarted] = useState(false)

  // Create the engine once, the first time scene is (or becomes) 'console'.
  // Mount-only effect (empty deps): checks the current scene immediately
  // (covers the case where 'console' is already active when this hook first
  // runs) then subscribes for later transitions. Guarded on
  // `!engineRef.current` so a scene flip back to 'console' after the first
  // dive-in never recreates the engine, matching legacy's `!window.__engine`
  // guard.
  useEffect(() => {
    function maybeCreate(scene: string): void {
      if (scene === 'console' && !engineRef.current) {
        engineRef.current = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
        setStarted(true)
      }
    }
    maybeCreate(useAppStore.getState().scene)
    const unsubscribe = useAppStore.subscribe((state) => maybeCreate(state.scene))
    return unsubscribe
  }, [])

  // Tick loop: starts once the engine exists (i.e. once `started` flips
  // true) and runs for the lifetime of this hook's mount. `backlog` /
  // `lastWall` are plain closure locals (not refs) — they're private to this
  // effect's own interval callback and never read/written outside it.
  useEffect(() => {
    const engine = engineRef.current
    if (!started || !engine) return

    let backlog = 0
    let lastWall = performance.now()

    // Mirrors main.js:68-72's absorbWallTime: pulls elapsed wall time into
    // the backlog (scaled by the live timeScale, re-read fresh each call so
    // a speed change takes effect immediately), clamped at MAX_BACKLOG.
    function absorb(): void {
      const now = performance.now()
      backlog = absorbWallTime(
        backlog,
        now - lastWall,
        useAppStore.getState().timeScale,
        MAX_BACKLOG,
      )
      lastWall = now
    }

    const intervalId = setInterval(() => {
      absorb()
      backlog = drainBacklog(backlog, SUB_STEP, (step) => engine.tick(step))
    }, TICK_MS)

    // Timers can be suspended entirely (laptop sleep, backgrounded tab);
    // clamp the accumulated gap the moment the tab is visible again so
    // there's no monster jump absorbed on the next interval firing
    // (mirrors main.js:81-85).
    function onVisibilityChange(): void {
      if (!document.hidden) absorb()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [started])

  return { engineRef, started }
}
