// Ported (Phase 1C / Task 4) from assets/js/ui/panels.js:2247-2278 (tweenStat)
// as a hook: animates a displayed integer from wherever it currently sits to
// a new `value` over STAT_TWEEN_MS, in integer steps, via rAF.
//
// tweenStat's "finish-safe by construction" guarantee — a NEW tween call on
// an element first clamps any in-flight tween straight to ITS OWN target
// before animating again (panels.js:2252-2257), so a stat can never get
// stuck mid-animation for more than one setStats cycle — is reproduced here
// via React's own cleanup ordering rather than an explicit statTweens Map:
// this effect's cleanup closure captures `goal` (that run's target), so when
// `value` changes and React tears down the previous effect run before
// starting the next, the OLD goal is what gets snapped to — exactly
// tweenStat's clamp-to-target behavior — before the new effect run reads
// `displayRef.current` as its `from`.

import { useEffect, useRef, useState } from 'react'

export const STAT_TWEEN_MS = 400

export function useCountUp(value: number, ms: number = STAT_TWEEN_MS): number {
  const goal = Math.round(value)
  const [display, setDisplay] = useState(goal)
  // Mirrors legacy reading `parseInt(el.textContent, 10)` as tweenStat's
  // `from` — a ref so the effect below can read the just-committed display
  // synchronously (state updates inside the same effect run are not visible
  // to a subsequent read of `display` until the next render).
  const displayRef = useRef(goal)

  useEffect(() => {
    const from = displayRef.current
    if (from === goal) return // panels.js:2260-2263: no-op when unchanged

    const start = performance.now()
    let rafId = 0
    function step(ts: number): void {
      const k = Math.min(1, (ts - start) / ms)
      const next = Math.round(from + (goal - from) * k)
      displayRef.current = next
      setDisplay(next)
      if (k < 1) rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(rafId)
      // Clamp to THIS run's own target (goal), not wherever the animation
      // happened to reach — panels.js:2254-2256's `el.textContent =
      // String(inFlight.target)`. Fires both when a new `value` supersedes
      // this tween and on unmount (harmless there: nothing reads
      // displayRef/state again).
      displayRef.current = goal
      setDisplay(goal)
    }
  }, [goal, ms])

  return display
}
