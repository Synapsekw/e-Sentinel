// Ported (Phase 1C / Task 4) from assets/js/main.js:28-31 (EC2.eventLevel)
// and assets/js/ui/panels.js:2366-2391 (pushEvent) / :2172-2175 (eventDroneId).
//
// Kept pure and DOM-free (unlike panels.js's pushEvent, which built + inserted
// a DOM node in one step) so it's unit-testable without a store, React, or a
// live engine. `mapEngineEvent` deliberately omits `id` from its return value
// — the store's `pushTickerEvent` (shared/store.ts) assigns that itself from a
// module-scoped counter, the one piece of required mutable state, so this
// module can stay a pure function of its inputs.
//
// `appendCapped` (the bounded newest-first insert pushTickerEvent uses) and
// the `TickerEventInput` type live in shared/store.ts, not here — this is a
// console-feature module, and shared code must not depend on it (layering:
// Phase 1C final review). This module consumes `TickerEventInput` from
// shared as the return type of `mapEngineEvent` below.

import type { SimEvent } from '@/modules/console/domain'
import type { TickerEvent, TickerEventInput } from '@/shared/store'

export type TickerEventLevel = TickerEvent['level']

// Canonical implementation moved to chrome/format.ts (Phase 1D Task 1) so
// there is exactly one copy; re-exported here so every existing import of
// nowClockStr from this module keeps working.
export { nowClockStr } from '@/modules/console/chrome/format'

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
export function mapEngineEvent(ev: SimEvent, clock: () => string): TickerEventInput {
  return {
    time: clock(),
    source: ev.source,
    message: ev.message,
    level: eventLevel(ev.level),
    droneId: droneIdFromSource(ev.source),
  }
}
