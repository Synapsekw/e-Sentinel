// Ported (Phase 1C / Task 4) from assets/js/main.js:28-31 (EC2.eventLevel)
// and assets/js/ui/panels.js:2366-2391 (pushEvent) / :2172-2175 (eventDroneId).
//
// Kept pure and DOM-free (unlike panels.js's pushEvent, which built + inserted
// a DOM node in one step) so it's unit-testable without a store, React, or a
// live engine. `mapEngineEvent` deliberately omits `id` from its return value
// — the store's `pushTickerEvent` (shared/store.ts) assigns that itself from a
// module-scoped counter, the one piece of required mutable state, so this
// module can stay a pure function of its inputs.

import type { SimEvent } from '@/modules/console/domain'
import type { TickerEvent } from '@/shared/store'

export type TickerEventLevel = TickerEvent['level']

// main.js:26-31. The engine's own event.level already carries 'alert'/'warn'
// for forced-RTB / dock-fault / advisory events; anything else (including
// engine levels this port doesn't otherwise special-case, e.g. 'debug')
// collapses to 'info'.
export function eventLevel(rawLevel: string): TickerEventLevel {
  return rawLevel === 'alert' || rawLevel === 'warn' ? rawLevel : 'info'
}

// panels.js:2172-2175 (eventDroneId): legacy checked the source id against
// the *live* engine's drone map (`window.__engine.drones.has(source)`).
// mapEngineEvent has no engine reference (by design — see interface note in
// task-4-brief.md), so this ports the same intent structurally: engine.ts:400
// mints every drone id as `'D-' + dockId`, so a `D-`-prefixed source is a
// drone-sourced event; dock/OPS/site events never carry that prefix.
function droneIdFromSource(source: string): string | null {
  return source.startsWith('D-') ? source : null
}

// panels.js:2370 (`ev.time || nowClockStr()`): legacy's engine-sourced calls
// into pushEvent never set `ev.time`, so in practice this fallback always
// fired — the real-world wall clock (not the sim clock; SimEvent.time is sim
// seconds since engine start, not a clock reading), formatted HH:MM:SS. The
// caller supplies `clock` as a function (rather than mapEngineEvent calling
// `new Date()` itself) purely so the mapping stays deterministic/testable.
export function nowClockStr(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

// The shape mapEngineEvent produces: everything pushTickerEvent needs except
// the id it assigns itself.
export type TickerEventInput = Omit<TickerEvent, 'id'>

export function mapEngineEvent(ev: SimEvent, clock: () => string): TickerEventInput {
  return {
    time: clock(),
    source: ev.source,
    message: ev.message,
    level: eventLevel(ev.level),
    droneId: droneIdFromSource(ev.source),
  }
}

// Bounded newest-first insert (pushEvent, panels.js:2384+2390: `insertBefore
// (..., stream.firstChild)` then `while (stream.children.length > 30)
// stream.removeChild(stream.lastChild)`). Generic so it can be exercised
// without constructing TickerEvent values in tests; shared/store.ts's
// pushTickerEvent calls it with cap 30.
export function appendCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [item, ...list]
  return next.length > cap ? next.slice(0, cap) : next
}
