// Ported (Phase 1D / Task 2) from assets/js/ui/panels.js:2587-2631 (wireScene),
// specifically the `setVisible` closure at :2596-2612. Legacy looped over a
// fixed list of chrome DOM nodes (topbar/side/rpanel/ticker/toggles) and
// imperatively flipped `.hidden`/`.style.opacity` on each; this hook instead
// returns the two derived flags for a single scene value, and ConsoleChrome
// applies them to every chrome element it renders via `hidden`/`style.opacity`
// props — same visible effect, React-idiomatic mechanism.
//
// - On show: cancel any pending hide timer (panels.js:2596-2599 — a scene
//   flip back to 'console' before a prior hide has landed must not let the
//   chrome vanish), un-hide immediately, then flip opacity to 1 on the next
//   paint. Legacy used a double rAF (let opacity:0 paint before transitioning
//   to 1) plus a 120ms setTimeout fallback for rAF-throttled contexts
//   (background/embedded tabs) where those frames may never come — both are
//   reproduced verbatim, whichever fires first wins (setState is idempotent).
// - On hide: opacity flips to 0 immediately; `hidden` is set true only after
//   the 220ms transition has had time to land, so the CSS opacity transition
//   is visible before the element leaves the layout.

import { useEffect, useRef, useState } from 'react'
import type { Scene } from '@/shared/store'

const HIDE_DELAY_MS = 220
const REVEAL_FALLBACK_MS = 120

export interface ChromeFadeState {
  hidden: boolean
  opacity: 0 | 1
}

export function useChromeFade(scene: Scene): ChromeFadeState {
  const show = scene === 'console'
  // Chrome starts hidden/transparent unless the very first render is already
  // the console scene (mirrors legacy's initial `setVisible(EC2.state.scene
  // === 'console')` call, panels.js:2610).
  const [state, setState] = useState<ChromeFadeState>(() =>
    show ? { hidden: false, opacity: 1 } : { hidden: true, opacity: 0 },
  )

  // Latches the pending timers so a later effect run (or unmount) can cancel
  // exactly what the previous run scheduled, matching legacy's single
  // module-scoped `hideTimer` plus wireScene's rAF-then-rAF reveal chain.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafOuterRef = useRef<number | null>(null)
  const rafInnerRef = useRef<number | null>(null)

  useEffect(() => {
    function clearHide(): void {
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
    function clearReveal(): void {
      if (revealFallbackRef.current != null) {
        clearTimeout(revealFallbackRef.current)
        revealFallbackRef.current = null
      }
      if (rafOuterRef.current != null) {
        cancelAnimationFrame(rafOuterRef.current)
        rafOuterRef.current = null
      }
      if (rafInnerRef.current != null) {
        cancelAnimationFrame(rafInnerRef.current)
        rafInnerRef.current = null
      }
    }

    if (show) {
      // panels.js:2596-2599: a show cancels any hide scheduled by a recent
      // setVisible(false).
      clearHide()
      setState({ hidden: false, opacity: 0 })

      const reveal = (): void => {
        clearReveal()
        setState({ hidden: false, opacity: 1 })
      }
      // Double rAF lets the opacity:0 state paint before transitioning to 1;
      // the timeout is a fallback for rAF-throttled contexts.
      rafOuterRef.current = requestAnimationFrame(() => {
        rafInnerRef.current = requestAnimationFrame(reveal)
      })
      revealFallbackRef.current = setTimeout(reveal, REVEAL_FALLBACK_MS)
    } else {
      clearReveal()
      setState((prev) => ({ hidden: prev.hidden, opacity: 0 }))
      clearHide()
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null
        setState({ hidden: true, opacity: 0 })
      }, HIDE_DELAY_MS)
    }

    return () => {
      clearHide()
      clearReveal()
    }
  }, [show])

  return state
}
