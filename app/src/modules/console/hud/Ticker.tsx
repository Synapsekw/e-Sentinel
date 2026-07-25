// Ported (Phase 1C / Task 4) from console.html:80 (`#ticker`/`#tickstream`
// markup), assets/js/ui/panels.js:2366-2391 (pushEvent's chip markup — the
// `.tt`/`.src`/`.msg` spans, level class, and the scroll-compensation on
// prepend) and :2209-2234 (startTickerDriver's auto-scroll rAF).
//
// `tickerEvents` from the store is already newest-first (see
// shared/store.ts's pushTickerEvent -> its own appendCapped), so
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

  // pushEvent's scroll-steady compensation (panels.js:2386-2389): each
  // prepended chip would otherwise shift a scrolled/hovered view right under
  // the reader, so legacy adds `el.offsetWidth + TICK_GAP` to scrollLeft
  // *per pushEvent call*. React 18 batches multiple pushTickerEvent calls
  // that land in the same tick (e.g. several engine events drained together
  // by useLiveLayers) into a single render, so this effect must compensate
  // for ALL chips prepended since the last render — not just one — or a
  // batched arrival under-compensates and the reader sees a leftward jump.
  //
  // The count of newly-prepended chips is the index of the previous render's
  // first-event id within the current (newest-first) `events` array: any
  // events ahead of it in the array are new. Only compensate when not
  // already parked at the newest end (scrollLeft 0), matching legacy exactly.
  // Runs synchronously before paint (useLayoutEffect) so the compensating
  // scroll happens in the same frame as the DOM insert, with no visible jump.
  useLayoutEffect(() => {
    const stream = streamRef.current
    const newFirstId = events.length > 0 ? events[0].id : null
    const prevId = prevFirstIdRef.current

    if (stream && prevId !== null && newFirstId !== null && newFirstId !== prevId) {
      const prevIndex = events.findIndex((ev) => ev.id === prevId)
      // Normally prevIndex *is* the number of chips prepended since the last
      // render (everything ahead of the old-first chip in the newest-first
      // array is new). If the previous first id isn't found at all, every
      // chip visible last render has fallen off the 30-cap in one batch —
      // there's no way to recover exactly how many chips are new, so fall
      // back to compensating for all currently-rendered chips. That's an
      // approximation (it under-compensates if the batch exceeded the cap),
      // but it's strictly closer to steady than compensating for just one
      // chip, and this path is only reachable by an extreme same-tick batch.
      const insertedCount = prevIndex === -1 ? events.length : prevIndex
      if (insertedCount > 0 && stream.scrollLeft > 0) {
        const children = stream.children
        let delta = 0
        for (let i = 0; i < insertedCount && i < children.length; i++) {
          delta += (children[i] as HTMLElement).offsetWidth + TICK_GAP
        }
        if (delta > 0) stream.scrollLeft += delta
      }
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
