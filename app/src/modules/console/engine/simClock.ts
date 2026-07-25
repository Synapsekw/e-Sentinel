// Ported (Phase 1C / Task 1) from assets/js/main.js:64-80 (startEngine's
// wall-clock accumulator + sub-step drain loop). The legacy code inlined
// this as module-scoped `backlog`/`lastWall` state closed over inside
// `startEngine`; here the pure math is extracted so it can be unit-tested
// without a running engine, timers, or the DOM. useSimEngine.ts owns the
// timers/refs and calls these two functions each tick.

export const SUB_STEP = 0.5 // max sim seconds per engine.tick()
export const MAX_BACKLOG = 30 // sim seconds; excess wall time is dropped
export const TICK_MS = 250

// Accumulate elapsed wall time (ms) scaled by timeScale into the sim backlog,
// clamped so a long background stint can't spiral. Mirrors main.js:68-72.
export function absorbWallTime(
  backlog: number,
  elapsedMs: number,
  timeScale: number,
  maxBacklog: number,
): number {
  return Math.min(maxBacklog, backlog + (elapsedMs / 1000) * timeScale)
}

// Drain the backlog in fixed sub-steps (each <= subStep), calling tick(step)
// per sub-step; return the leftover backlog. Mirrors main.js:75-79.
//
// The subtraction is rounded to 9 decimal places each iteration: repeated
// float subtraction of values like 0.5 from 1.2 drifts to
// 0.19999999999999996 rather than 0.2, which then leaks into the final
// partial-step size passed to `tick`. Legacy's inline version never
// surfaces this (it's never compared for exact equality), but this
// extracted function is; rounding away sub-nanosecond drift keeps the
// final partial step numerically clean without materially affecting the
// simulation, which never depends on backlog precision below 1e-4s.
export function drainBacklog(
  backlog: number,
  subStep: number,
  tick: (step: number) => void,
): number {
  let remaining = backlog
  while (remaining > 1e-4) {
    const step = Math.min(subStep, remaining)
    tick(step)
    remaining = Math.round((remaining - step) * 1e9) / 1e9
  }
  return remaining
}
