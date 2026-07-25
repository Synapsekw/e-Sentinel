// Ported (Phase 1C / Task 4) from console.html:80 (`#ticker`/`#tickstream`
// markup), assets/js/ui/panels.js:2366-2391 (pushEvent's chip markup — the
// `.tt`/`.src`/`.msg` spans, level class, and the scroll-compensation on
// prepend) and :2209-2234 (startTickerDriver's auto-scroll rAF).
//
// `tickerEvents` from the store is already newest-first (see
// shared/store.ts's pushTickerEvent -> tickerModel.ts's appendCapped), so
// mapping it in array order reproduces pushEvent's `insertBefore(...,
// stream.firstChild)` without needing to prepend manually.
//
// Click-through to a drone (panels.js:2176-2190's focusDroneFromEvent, the
// is-active/is-past recolor loop) is explicitly deferred to Phase 1D
// (selection) per the task brief — not built here, even though `droneId` is
// already threaded onto each TickerEvent for that later wiring to consume.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAppStore } from '@/shared/store'
import './hud.css'

// panels.js:2219 — a calm national-grid crawl, not a stock ticker.
const TICKER_SCROLL_SPEED = 0.35 // px/frame
// panels.js:2167 — mirrors #tickstream's CSS `gap`, used below to keep a
// scrolled/hovered view steady when a new chip is prepended at the left edge.
const TICK_GAP = 22

export default function Ticker() {
  const events = useAppStore((s) => s.tickerEvents)
  const streamRef = useRef<HTMLDivElement | null>(null)
  // Legacy's `paused` closure local (panels.js:2215) — a ref so the rAF loop
  // below can read it synchronously without depending on React state (and
  // thus without tearing the loop down/rebuilding it on every hover).
  const pausedRef = useRef(false)
  // The previous render's newest event id, so the scroll-compensation effect
  // below can tell "a new chip actually arrived" apart from an unrelated
  // rerender (e.g. a sibling GridStats tween) that leaves `events` identity
  // changed but its first id the same.
  const prevFirstIdRef = useRef<number | null>(null)

  // Continuous auto-scroll + hover-pause + end-of-strip wrap
  // (startTickerDriver, panels.js:2209-2229). Runs for the component's
  // lifetime; cancelled on unmount.
  useEffect(() => {
    const stream = streamRef.current
    if (!stream) return

    let rafId = 0
    function frame(): void {
      rafId = requestAnimationFrame(frame)
      if (pausedRef.current) return
      // Non-null: guarded by the `if (!stream) return` above this closure's
      // definition — `stream` is a `const` that TS's closure analysis
      // doesn't re-narrow inside a nested function declaration (same
      // pattern as useLiveLayers.ts's frame()).
      const max = stream!.scrollWidth - stream!.clientWidth
      if (max <= 4) return
      stream!.scrollLeft += TICKER_SCROLL_SPEED
      if (stream!.scrollLeft >= max - 1) stream!.scrollLeft = 0
    }
    rafId = requestAnimationFrame(frame)

    return () => cancelAnimationFrame(rafId)
  }, [])

  // pushEvent's scroll-steady compensation (panels.js:2386-2389): a chip
  // prepended at the left edge would otherwise shift a scrolled/hovered view
  // right under the reader; only compensate when not already parked at the
  // newest end (scrollLeft 0), so the live newest chip staying visible is
  // unaffected. Runs synchronously before paint (useLayoutEffect) so the
  // compensating scroll happens in the same frame as the DOM insert, with no
  // visible jump.
  useLayoutEffect(() => {
    const stream = streamRef.current
    const newFirstId = events.length > 0 ? events[0].id : null
    const isFreshInsert =
      newFirstId !== null &&
      prevFirstIdRef.current !== null &&
      newFirstId !== prevFirstIdRef.current
    if (stream && isFreshInsert && stream.scrollLeft > 0) {
      const first = stream.firstElementChild as HTMLElement | null
      if (first) stream.scrollLeft += first.offsetWidth + TICK_GAP
    }
    prevFirstIdRef.current = newFirstId
  }, [events])

  return (
    <footer id="ticker" hidden={events.length === 0}>
      <span className="lbl">EVENTS</span>
      <div
        id="tickstream"
        ref={streamRef}
        onMouseEnter={() => {
          pausedRef.current = true
        }}
        onMouseLeave={() => {
          pausedRef.current = false
        }}
      >
        {events.map((ev) => (
          <span
            key={ev.id}
            className={
              'tick-ev' + (ev.level === 'warn' ? ' warn' : ev.level === 'alert' ? ' alert' : '')
            }
          >
            <span className="tt">{ev.time}</span>
            <span className="src">{ev.source}</span>
            <span className="msg">{ev.message}</span>
          </span>
        ))}
      </div>
    </footer>
  )
}
