// Ported (Phase 1C / Task 4; drone click-through added Phase 1D / Task 8)
// from console.html:80 (`#ticker`/`#tickstream` markup), assets/js/ui/
// panels.js:2366-2391 (pushEvent's chip markup — the `.tt`/`.src`/`.msg`
// spans, level class, and the scroll-compensation on prepend), :2209-2234
// (startTickerDriver's auto-scroll rAF + 1000ms recolor interval),
// :2172-2203 (eventDroneId / focusDroneFromEvent / applyDroneActivity) and
// :2374-2385 (pushEvent's drone-ev chip tagging).
//
// `tickerEvents` from the store is already newest-first (see
// shared/store.ts's pushTickerEvent -> its own appendCapped), so
// mapping it in array order reproduces pushEvent's `insertBefore(...,
// stream.firstChild)` without needing to prepend manually.
//
// `engine`/`map` are optional props defaulting to the ambient
// EngineProvider/MapView context, same pattern as chrome/DockList.tsx and
// chrome/RequestBoard.tsx — so Ticker.test.tsx can drive a fake engine/map
// without a provider harness, and the recolor loop / click-through below
// have something to read even when Ticker renders outside <MapView> (e.g.
// this component is Console.tsx's `ticker` slot, mounted for the whole app
// lifetime via ConsoleChrome, not gated on the map being ready).

import { useContext, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { useAppStore } from '@/shared/store'
import type { Engine } from '@/modules/console/domain'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { MapContext } from '@/modules/console/map/MapContext'
import { selectEntity, inCaptureMode, openDebrief } from '@/modules/console/selection'
import './hud.css'

// panels.js:2219 — a calm national-grid crawl, not a stock ticker.
const TICKER_SCROLL_SPEED = 0.35 // px/frame
// panels.js:2167 — mirrors #tickstream's CSS `gap`, used below to keep a
// scrolled/hovered view steady when a new chip is prepended at the left edge.
const TICK_GAP = 22
// panels.js:2230 — how often applyDroneActivity re-tags every drone-ev chip
// from the drone's CURRENT state, so the ribbon's colors track reality (a
// drone launching/landing after its chip was pushed) rather than just the
// moment the line fired.
const DRONE_ACTIVITY_INTERVAL_MS = 1000
// panels.js:2188 — focusDroneFromEvent's camera ease.
const DRONE_FOCUS_ZOOM = 12.5
const DRONE_FOCUS_DURATION_MS = 600

// Mirrors useEngine() but returns null instead of throwing when there is no
// ambient <EngineProvider> (see chrome/DockList.tsx's header comment for
// why this pattern exists).
function useOptionalEngine(): Engine | null {
  const ctx = useContext(EngineContext)
  return ctx ? ctx.engineRef.current : null
}

// Mirrors useMap() but returns null instead of throwing when there is no
// ambient <MapView>.
function useOptionalMap(): maplibregl.Map | null {
  const ctx = useContext(MapContext)
  return ctx ? ctx.mapRef.current : null
}

// panels.js:2176-2189 (focusDroneFromEvent): click-through from a ticker
// chip to its drone, only when that drone is still airborne. A landed/past
// or unknown drone does nothing. Yields to inCaptureMode() so it can't yank
// the map out from under an in-progress wizard/manual session (Phase 1E).
function focusDroneFromEvent(
  droneId: string,
  engine: Engine | null,
  map: maplibregl.Map | null,
): void {
  if (inCaptureMode()) return
  const drone = engine && engine.drones.get(droneId)
  if (!drone || drone.state === 'docked') return
  useAppStore.getState().setFollowDroneId(droneId)
  selectEntity({ type: 'drone', id: droneId }, engine, map)
  if (map) {
    map.easeTo({ center: drone.pos, zoom: DRONE_FOCUS_ZOOM, duration: DRONE_FOCUS_DURATION_MS })
  }
}

// panels.js:2196-2203 (applyDroneActivity): a drone-sourced chip reads
// is-active (live + colorized + clickable) when its drone is still airborne,
// is-past (dimmed) otherwise — including when the drone id names no live
// drone at all (e.g. a past sim run, or before the engine has booted).
function isDroneActive(droneId: string | null, engine: Engine | null): boolean {
  if (!droneId) return false
  const drone = engine && engine.drones.get(droneId)
  return !!(drone && drone.state !== 'docked')
}

export interface TickerProps {
  engine?: Engine | null
  map?: maplibregl.Map | null
}

export default function Ticker({ engine: engineProp, map: mapProp }: TickerProps = {}) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

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

  // panels.js:2230-2233's recolor interval: bumps a counter every 1000ms so
  // every drone-ev chip's is-active/is-past class is recomputed from the
  // drone's CURRENT state at render time (isDroneActive reads `engine`
  // fresh below, nothing is cached in React state) — same
  // read-live-state-on-a-forced-tick pattern as chrome/DockList.tsx's
  // LIVE_REFRESH_MS poll. Runs for the component's lifetime.
  const [, forceRecolor] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    const id = setInterval(forceRecolor, DRONE_ACTIVITY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

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
        {events.map((ev) => {
          const isDroneChip = ev.droneId !== null
          const active = isDroneChip && isDroneActive(ev.droneId, engine)
          // panels.js:2376+2382 — an explicit ev.onClick (the DEBRIEF READY
          // chip) took precedence over the drone jump and carried the
          // `clickable` class instead of the drone-activity classes.
          const missionId = ev.missionId ?? null
          const className =
            'tick-ev' +
            (ev.level === 'warn' ? ' warn' : ev.level === 'alert' ? ' alert' : '') +
            (missionId ? ' clickable' : '') +
            (isDroneChip ? ' drone-ev' + (active ? ' is-active' : ' is-past') : '')
          return (
            <span
              key={ev.id}
              className={className}
              data-drone={ev.droneId ?? undefined}
              onClick={
                missionId
                  ? () => {
                      if (inCaptureMode()) return
                      openDebrief(missionId)
                    }
                  : isDroneChip
                    ? () => focusDroneFromEvent(ev.droneId as string, engine, map)
                    : undefined
              }
            >
              <span className="tt">{ev.time}</span>
              <span className="src">{ev.source}</span>
              <span className="msg">{ev.message}</span>
            </span>
          )
        })}
      </div>
    </footer>
  )
}
