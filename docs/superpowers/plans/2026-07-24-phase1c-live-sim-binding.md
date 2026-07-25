# Phase 1C: Live Sim Binding (engine → map + HUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the Phase 1A simulation engine to the Phase 1B map: a React-owned tick loop advances the engine, an rAF render loop feeds the live map sources (drones fly, trails/leaders/missions/tracks update), launch-FX pulses fire, and a live HUD (grid stat tiles + event ticker) reflects engine state — all mounted in the existing `/console` route.

**Architecture:** The engine instance (`SimEngine.create` from `@/modules/console/domain`) is created once and held in a ref, exposed via an `EngineContext`. A `setInterval`-driven tick loop (wall-clock accumulator × `timeScale`, fixed sub-steps, 30s backlog cap) advances sim time independently of rAF (which browsers throttle in background tabs). A separate rAF render loop calls the ported `updateLiveLayers` — imperative `setData` on the live geojson sources — and throttles a 1 Hz stats snapshot into the store. The engine's `onEvent` feeds the ticker (bounded event list in the store) and launch-FX pulses. Per-frame map updates stay fully imperative (never React state); only the low-frequency HUD (stats ~1 Hz, ticker on-event) flows through React. This is a faithful port of `assets/js/main.js` (the loop) + `map.js`'s `updateLiveLayers`/build-helpers + `panels.js`'s stat/ticker logic.

**Tech Stack:** React 18, TypeScript (strict), MapLibre GL v5, Zustand, the Phase 1A domain + Phase 1B map/globe, Vitest.

## Global Constraints

- **Consumes Phase 1A domain** (`@/modules/console/domain`: `SimEngine`, `Engine`, `SimRouter`, `DATA_DOCKS`, `GEO_UAE`, types) and **Phase 1B map** (`@/modules/console/map`: `useMap`, the live sources already in the style, `fxPulses`/ping driver). Do not re-implement engine or map logic.
- **Faithful port** of the sim loop, `updateLiveLayers` + all build helpers, `refreshCounts`, and the ticker/stat logic from `assets/js/main.js`, `assets/js/ui/map.js:189-456`, and `assets/js/ui/panels.js` (setStats/tweenStat/pushEvent/startTickerDriver). Numeric constants (SUB_STEP 0.5, MAX_BACKLOG 30, tick 250ms, TRAIL_MAX_POINTS 40, TRAIL_MIN_STEP_M 120, leader 800m, FX_PULSE_* , STAT_TWEEN_MS 400, ticker SPEED 0.35, cap 30) verbatim.
- **Per-frame map updates are imperative, never React state.** `updateLiveLayers` runs in an rAF effect calling `source.setData(...)`. Only the 1 Hz stats snapshot and on-event ticker list are React/store state. A 60fps React re-render of drone positions is forbidden.
- **rAF/timers/listeners live in effects, cleaned up on unmount.** The tick `setInterval`, the render rAF, the ticker scroll rAF, and the `visibilitychange`/`onEvent` listeners are all torn down. No leaks across route remounts or StrictMode.
- **Single engine instance** in a ref (never React state, never recreated on re-render). Started the first time the console scene is entered (matching legacy `main.js:13-15`).
- **Legacy stays live.** Only `app/` touched; `assets/`, `console.html`, `deploy.yml` untouched.
- **Determinism:** the engine is the Phase 1A seeded engine; time advances only via `engine.tick(dt)`. Do not add `Math.random`; `performance.now()` is used only for wall-clock delta + FX timestamps (as legacy does).
- **npm scripts on this Windows checkout:** repo path contains `&`. Run `npm run ...`/`npm test` via Bash with `export npm_config_script_shell=bash`; before `git commit` also `export PATHEXT=";$PATHEXT"`. npm from `app/`, git from repo root, quote paths.
- **Console voice:** mono micro-labels 9.5px/.22em/uppercase; no em dashes. Stat/ticker copy transcribed from legacy.
- Import shared/domain/map code via the `@/` alias.

---

### Task 1: Engine hook, sim tick loop, and store slices

**Files:**
- Create: `app/src/modules/console/engine/simClock.ts`
- Create: `app/src/modules/console/engine/EngineContext.ts`
- Create: `app/src/modules/console/engine/useSimEngine.ts`
- Test: `app/src/modules/console/engine/simClock.test.ts`
- Modify: `app/src/shared/store.ts` (add `timeScale`, `selection`, `followDroneId`, `stats` slices + actions)
- Source refs: `assets/js/main.js:51-97` (startEngine loop), `main.js:2` (state shape).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`SimEngine`, `Engine`), `@/shared/store`.
- Produces:
  - `simClock.ts`: pure `absorbWallTime(backlog, elapsedMs, timeScale, maxBacklog): number` and `drainBacklog(backlog, subStep, tick: (step: number) => void): number` — the accumulator + sub-step drain, extracted for testing. Constants `SUB_STEP = 0.5`, `MAX_BACKLOG = 30`, `TICK_MS = 250`.
  - `EngineContext`: `React.Context<{ engineRef: React.MutableRefObject<Engine | null>; started: boolean } | null>`; hook `useEngine()`.
  - `useSimEngine()`: creates the engine once (`SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })`) on first console-scene entry, runs the tick `setInterval` + `visibilitychange` clamp, returns the context value. Subscribes `engine.onEvent` is NOT here (that's Task 3).
  - Store gains: `timeScale: number` (default 1), `selection: Selection | null` (default null; `Selection = { type: 'dock' | 'drone' | 'site'; id: string }`), `followDroneId: string | null` (default null), `stats: GridStats` (default `{ ready: 0, flying: 0, charge: 0, alert: 0 }`), and actions `setTimeScale`, `setSelection`, `setFollowDroneId`, `setStats`. Export `Selection`, `GridStats` types.

- [ ] **Step 1: Extend the store**

Add to `app/src/shared/store.ts` (keep existing scene/layer/offline): the `Selection`/`GridStats` types, the four new state fields with defaults above, and their setters. `pushTickerEvent` is added in Task 4 — not here.

- [ ] **Step 2: Write the failing `simClock.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { absorbWallTime, drainBacklog, SUB_STEP, MAX_BACKLOG } from './simClock'

describe('simClock', () => {
  it('accumulates wall time scaled by timeScale, capped at MAX_BACKLOG', () => {
    expect(absorbWallTime(0, 1000, 1, MAX_BACKLOG)).toBeCloseTo(1, 5)
    expect(absorbWallTime(0, 1000, 4, MAX_BACKLOG)).toBeCloseTo(4, 5)
    expect(absorbWallTime(29, 5000, 1, MAX_BACKLOG)).toBe(MAX_BACKLOG)
  })
  it('drains the backlog in sub-steps no larger than SUB_STEP and returns the remainder', () => {
    const steps: number[] = []
    const rem = drainBacklog(1.2, SUB_STEP, (s) => steps.push(s))
    expect(steps).toEqual([0.5, 0.5, 0.2])
    expect(rem).toBeCloseTo(0, 5)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `app/`, `export npm_config_script_shell=bash`): `npm run test -- src/modules/console/engine/simClock.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `simClock.ts`**

```ts
export const SUB_STEP = 0.5
export const MAX_BACKLOG = 30
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
export function drainBacklog(backlog: number, subStep: number, tick: (step: number) => void): number {
  let remaining = backlog
  while (remaining > 1e-4) {
    const step = Math.min(subStep, remaining)
    tick(step)
    remaining -= step
  }
  return remaining
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/modules/console/engine/simClock.test.ts` → 2/2 pass.

- [ ] **Step 6: Write `EngineContext.ts`**

```ts
import { createContext, useContext } from 'react'
import type { Engine } from '@/modules/console/domain'

export interface EngineContextValue {
  engineRef: React.MutableRefObject<Engine | null>
  started: boolean
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used within <EngineProvider>')
  return ctx
}
```

- [ ] **Step 7: Write `useSimEngine.ts`**

An effect hook: hold `engineRef` (a `useRef<Engine | null>`), `started` state. Subscribe to `useAppStore` scene; the first time scene becomes `'console'` and no engine exists, create `SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })`, store in the ref, set `started`. Start the tick loop: a `setInterval(..., TICK_MS)` closure holding `backlog`/`lastWall` (refs), each tick calls `absorbWallTime` (using `useAppStore.getState().timeScale`) then `drainBacklog(backlog, SUB_STEP, (s) => engine.tick(s))`. Add the `visibilitychange` listener (on visible, absorb wall time to clamp). Return `{ engineRef, started }` for `EngineContext`. Cleanup: clear the interval, remove the listener, unsubscribe. (The `onEvent` wiring and the render loop are Task 3.)

- [ ] **Step 8: Verify + commit**

Run (from `app/`): `npm run test`, `npm run typecheck`, `npm run lint` — green.
```bash
git add app/src/modules/console/engine/ app/src/shared/store.ts
git commit -m "feat: sim engine hook + tick loop + store slices (Phase 1C)"
```

---

### Task 2: Live feature builders, updateLiveLayers, and FX module

**Files:**
- Create: `app/src/modules/console/map/liveFeatures.ts`
- Create: `app/src/modules/console/map/updateLiveLayers.ts`
- Create: `app/src/modules/console/map/fx.ts`
- Modify: `app/src/modules/console/map/usePingDriver.ts` (import `fxPulses`/constants from `fx.ts` instead of local)
- Test: `app/src/modules/console/map/liveFeatures.test.ts`
- Source refs: `assets/js/ui/map.js:189-456` (all build helpers, updateLiveLayers, spotlitMissionId, updateTrails, applyCoverageHighlight), `map.js:390-407` (fxPulses/launchPulse).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`Engine`, `SimRouter`, `DATA_DOCKS`, types), `@/shared/store` (`Selection`).
- Produces:
  - `liveFeatures.ts` (pure): `buildDockFeatures(engine, selection)`, `buildDroneFeatures(engine)`, `buildLeaderFeatures(engine)`, `buildMissionLineFeatures(engine, spotId)`, `buildTrackFeatures(engine)`, `spotlitMissionId(engine, selection, followDroneId)`, and a `TrailStore` class/factory wrapping `droneTrails` + `updateTrails(engine)` + `buildTrailFeatures()` (the trail state must be instance-scoped, not module-global, so a route remount starts clean). All return typed `FeatureCollection`.
  - `fx.ts`: `FX_PULSE_LIFE_MS`, `FX_PULSE_RINGS`, `FX_PULSE_STAGGER_MS`, the `fxPulses` array, and `pushLaunchPulse(dockId, map, scene)` (transcribe `launchPulse` map.js:400-407 — guard console scene + map loaded, find dock coords from `DATA_DOCKS`, push `{ coords, start: performance.now() }`).
  - `updateLiveLayers.ts`: `createLiveLayerUpdater()` returning `update(engine, map, selection, followDroneId)` — the imperative orchestration (setData on docks/drones/drone-leaders/drone-trails, mission/track dirty-check keys, `applyCoverageHighlight`). The dirty-check state (`lastActiveMissionsKey`, `lastTracksKey`, `lastCoverageSel`, the `TrailStore`) lives in the closure so it resets per updater instance. Also expose `setRangeHighlight(dockId)` for later phases (stashes an id, re-applies coverage filter). Transcribe map.js:415-456 + applyCoverageHighlight 371-388.

- [ ] **Step 1: Write `fx.ts`** — extract the FX constants + `fxPulses` array from `usePingDriver.ts`, add `pushLaunchPulse` (transcribe map.js:400-407, typed).

- [ ] **Step 2: Update `usePingDriver.ts`** — import `fxPulses` + `FX_PULSE_*` from `./fx` instead of its local copies; behavior unchanged. Verify the ping driver still builds.

- [ ] **Step 3: Write `liveFeatures.ts`** — transcribe the build helpers (map.js:189-345) verbatim, typed. `buildDockFeatures` takes `selection` (for the `selected` prop; null → all false). `spotlitMissionId` takes `(engine, selection, followDroneId)`. The trail logic (`droneTrails`/`updateTrails`/`buildTrailFeatures`, map.js:305-345) becomes a `TrailStore` (instance-scoped Map, not module-global). Leader uses `SimRouter.offsetMeters` (imported, not `window.SimRouter`). No `any`.

- [ ] **Step 4: Write `updateLiveLayers.ts`** — `createLiveLayerUpdater()` closure holding the dirty-check keys + a `TrailStore`; `update(engine, map, selection, followDroneId)` transcribes map.js:415-456 (guard map+engine, setData each source at most once/frame, mission/track only-on-change via the keys, `applyCoverageHighlight`). `applyCoverageHighlight`/`coverageHighlightIds` (map.js:357-380) transcribed, reading `selection` + the stashed range-highlight id. `setRangeHighlight` stashes + re-applies. No `any`; use the `asGeoJSONSource` narrowing pattern from Phase 1B for `getSource(...).setData`.

- [ ] **Step 5: Write `liveFeatures.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { buildDockFeatures, buildDroneFeatures, spotlitMissionId } from './liveFeatures'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5) // fly the sim ~200s so drones launch
  return e
}

describe('live feature builders', () => {
  it('buildDockFeatures emits one point per dock with live state', () => {
    const e = bootedEngine()
    const fc = buildDockFeatures(e, null)
    expect(fc.features.length).toBe(e.docks.size)
    expect(fc.features[0].properties?.selected).toBe(false)
  })
  it('buildDroneFeatures emits only airborne drones with finite positions', () => {
    const e = bootedEngine()
    const fc = buildDroneFeatures(e)
    let airborne = 0
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    expect(fc.features.length).toBe(airborne)
    expect(fc.features.every((f) => Number.isFinite((f.geometry as { coordinates: number[] }).coordinates[0]))).toBe(true)
  })
  it('spotlitMissionId returns the selected drone\'s mission, or null with no selection', () => {
    const e = bootedEngine()
    expect(spotlitMissionId(e, null, null)).toBe(null)
    const flying = [...e.drones.values()].find((d) => d.missionId)
    if (flying) expect(spotlitMissionId(e, { type: 'drone', id: flying.id }, null)).toBe(flying.missionId)
  })
})
```

- [ ] **Step 6: Verify + commit**

Run (from `app/`): `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green (builder tests pass; ping driver still builds after the fx refactor).
```bash
git add app/src/modules/console/map/
git commit -m "feat: live feature builders, updateLiveLayers, FX module (Phase 1C)"
```

---

### Task 3: Sim render loop, engine wiring, and drones flying on the map

**Files:**
- Create: `app/src/modules/console/engine/useLiveLayers.ts`
- Create: `app/src/modules/console/engine/refreshCounts.ts`
- Create: `app/src/modules/console/engine/EngineProvider.tsx`
- Modify: `app/src/modules/console/Console.tsx` (wrap with EngineProvider; call the render loop; wire onEvent)
- Test: `app/src/modules/console/engine/refreshCounts.test.ts`
- Source refs: `assets/js/main.js:35-49` (refreshCounts), `main.js:56-59` (onEvent → pushEvent/launchPulse), `main.js:87-96` (render loop).

**Interfaces:**
- Consumes: `useEngine()`, `useMap()`, `createLiveLayerUpdater`, `pushLaunchPulse`, `@/shared/store`.
- Produces:
  - `refreshCounts.ts`: pure `computeCounts(engine): GridStats` (transcribe main.js:35-44 — ready/charging/alert docks + airborne drones).
  - `EngineProvider.tsx`: calls `useSimEngine()`, provides `EngineContext`, renders children. Also wires `engine.onEvent` once (when started): each event → `useAppStore.getState().pushTickerEvent(mapped)` (Task 4 adds `pushTickerEvent`; until then, a local no-op is fine, but land the subscription here) and, on `code === 'MISSION_LAUNCHED'` with `dockId`, `pushLaunchPulse(ev.dockId, map, scene)`.
  - `useLiveLayers()`: an rAF render loop (started when engine `started` + map `ready`) that each frame calls the live-layer updater `update(engine, map, selection, followDroneId)` (reading selection/followDroneId from `useAppStore.getState()`), and throttles a 1 Hz `useAppStore.getState().setStats(computeCounts(engine))`. Cleanup cancels the rAF. Uses a single `createLiveLayerUpdater()` instance held in a ref.

- [ ] **Step 1: Write `refreshCounts.ts` + `refreshCounts.test.ts`**

`computeCounts(engine)` per main.js:35-44. Test:
```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { computeCounts } from './refreshCounts'

describe('computeCounts', () => {
  it('counts ready/charging/alert docks and airborne drones from live engine state', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 400; i++) e.tick(0.5)
    const c = computeCounts(e)
    let ready = 0, airborne = 0
    for (const d of e.docks.values()) if (d.state === 'ready') ready++
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    expect(c.ready).toBe(ready)
    expect(c.flying).toBe(airborne)
    expect(c.ready + c.flying).toBeLessThanOrEqual(e.docks.size + e.drones.size)
  })
})
```

- [ ] **Step 2: Write `EngineProvider.tsx`** — wraps `useSimEngine()`, provides context, wires `onEvent` (ticker push + launch pulse). Guard the `onEvent` subscription so it attaches once when `started` flips true and detaches on unmount.

- [ ] **Step 3: Write `useLiveLayers.ts`** — the rAF render loop per main.js:87-96, calling the updater + 1 Hz `setStats`. Held updater instance in a ref; cleanup cancels rAF.

- [ ] **Step 4: Wire into `Console.tsx`** — wrap the console tree in `<EngineProvider>`; inside the MapView subtree (where `useMap` + `useEngine` resolve), call `useLiveLayers()`. The engine starts on first dive into the console scene (as legacy). Keep the minimal chrome from 1B.

- [ ] **Step 5: Verify build + browser (drones fly)**

Run (from `app/`): `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green. Then `npm run dev`, open `/console`, dive into the theater, wait ~15s, and confirm via `read_console_messages` (no errors) and — if the browser pane composites — a screenshot showing drones (white chevrons) moving with leader lines/trails and mission routes. If the pane cannot composite, capture `read_network_requests` showing tile loads and note the visual is controller/user-verified. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/console/engine/ app/src/modules/console/Console.tsx
git commit -m "feat: sim render loop, engine event wiring, live drones on the map (Phase 1C)"
```

---

### Task 4: Grid stat tiles and event ticker HUD

**Files:**
- Create: `app/src/modules/console/hud/GridStats.tsx`
- Create: `app/src/modules/console/hud/useCountUp.ts`
- Create: `app/src/modules/console/hud/Ticker.tsx`
- Create: `app/src/modules/console/hud/hud.css`
- Modify: `app/src/shared/store.ts` (add `tickerEvents` slice + `pushTickerEvent`)
- Modify: `app/src/modules/console/engine/EngineProvider.tsx` (event mapping → `pushTickerEvent`)
- Modify: `app/src/modules/console/Console.tsx` (render `<GridStats/>` + `<Ticker/>` in the console chrome)
- Test: `app/src/modules/console/hud/tickerModel.test.ts`
- Create: `app/src/modules/console/hud/tickerModel.ts`
- Source refs: `assets/js/ui/panels.js:2209-2308` (startTickerDriver, tweenStat, setStats), `panels.js:2366-2391` (pushEvent), `main.js:28-31` (eventLevel), `console.html` (grid-stats + ticker DOM).

**Interfaces:**
- Consumes: `@/shared/store` (`stats`, `tickerEvents`), engine events.
- Produces:
  - Store gains `tickerEvents: TickerEvent[]` (bounded 30, newest first) + `pushTickerEvent(ev)`. `TickerEvent = { id: number; time: string; source: string; message: string; level: 'info' | 'warn' | 'alert'; droneId: string | null }`.
  - `tickerModel.ts`: pure `eventLevel(rawLevel)` (main.js:28-31) and `mapEngineEvent(ev, clock): TickerEvent` (formats a `SimEvent` into a `TickerEvent`, deriving `droneId` from `source` if it matches a `D-*` id). Bounded-insert helper `appendCapped(list, ev, cap)`.
  - `useCountUp(value, ms)`: animates a displayed integer from its previous value to `value` over `ms` (port of `tweenStat`, main.js panels.js:2247-2278), returning the current display number.
  - `GridStats.tsx`: renders the four tiles (READY / FLYING / CHARGING / ALERTS) from `useAppStore(s => s.stats)`, each via `useCountUp`. Copy/labels transcribed from `console.html` grid-stats.
  - `Ticker.tsx`: renders `tickerEvents` as chips (time · source · message, severity class), with the auto-scroll rAF (SPEED 0.35, hover-pause) ported from `startTickerDriver`. Click-through to a drone is deferred to Phase 1D (selection).

- [ ] **Step 1: Extend the store** — add `tickerEvents` + `pushTickerEvent` (uses `appendCapped(list, ev, 30)`; assign incrementing `id` for React keys via a module counter passed in, NOT `Date.now`).

- [ ] **Step 2: Write `tickerModel.ts` + `tickerModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { eventLevel, appendCapped } from './tickerModel'

describe('ticker model', () => {
  it('eventLevel passes through alert/warn and defaults others to info', () => {
    expect(eventLevel('alert')).toBe('alert')
    expect(eventLevel('warn')).toBe('warn')
    expect(eventLevel('info')).toBe('info')
    expect(eventLevel('debug')).toBe('info')
  })
  it('appendCapped keeps newest-first and caps length', () => {
    let list: number[] = []
    for (let i = 0; i < 35; i++) list = appendCapped(list, i, 30)
    expect(list.length).toBe(30)
    expect(list[0]).toBe(34)
    expect(list[29]).toBe(5)
  })
})
```
(Adjust `appendCapped`'s element type to `TickerEvent` in the real code; the test uses numbers to assert the cap/order contract.)

- [ ] **Step 3: Implement `tickerModel.ts` to green**, then run `npm run test -- src/modules/console/hud/tickerModel.test.ts`.

- [ ] **Step 4: Write `useCountUp.ts`** — the tween hook (port tweenStat: clamp in-flight to target on a new value, animate over STAT_TWEEN_MS=400 in integer steps via rAF, cleanup on unmount/new value).

- [ ] **Step 5: Write `GridStats.tsx` + `Ticker.tsx` + `hud.css`** — transcribe the tile/ticker markup + styles from `console.html` + `console.css` (grid-stats, ticker/.tick-ev/severity colors). `Ticker` runs the scroll rAF in an effect (cleanup cancels it).

- [ ] **Step 6: Wire event mapping + render** — in `EngineProvider.tsx`, map each engine event via `mapEngineEvent` and call `pushTickerEvent`. In `Console.tsx`, render `<GridStats/>` (in the console-scene chrome) and `<Ticker/>` (bottom), console-scene only.

- [ ] **Step 7: Verify build + browser (live HUD)**

Run (from `app/`): `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green. Then `npm run dev`, `/console`, dive in, wait ~15s: confirm no console errors and — if the pane composites — the stat tiles count up as drones launch and the ticker crawls with LAUNCH/COMPLETE/DETECTION events. Also `npm run preview` at `http://localhost:4173/e-Sentinel/console` (base-path sanity). Stop servers.

- [ ] **Step 8: Commit**

```bash
git add app/src/modules/console/hud/ app/src/shared/store.ts app/src/modules/console/engine/EngineProvider.tsx app/src/modules/console/Console.tsx
git commit -m "feat: live grid stat tiles + event ticker HUD (Phase 1C)"
```

---

## Self-Review

**Spec coverage (spec §8.1 Phase 1, the live-binding portion):**
- Sim tick loop (framework-free time via `tick(dt)`, background-safe timers) → Task 1 (`useSimEngine` + `simClock`).
- Live map layers fed from engine each frame → Tasks 2-3 (`updateLiveLayers` + `useLiveLayers`), imperative, faithful.
- Launch FX pulses from engine events → Tasks 2-3 (`fx.ts` + EngineProvider wiring).
- Live HUD (stat tiles + ticker) → Task 4.
- Engine is the Phase 1A domain, map is the Phase 1B surface — no re-implementation (Global Constraints).
- Legacy stays live → only `app/` touched.

**Explicitly out of Phase 1C scope (later sub-plans):** the real topbar/sidebar/right-panel and entity selection (Phase 1D); manual control / mission wizard / debrief / media / flight-request review (Phase 1E); the Pages deploy flip (Phase 1F). Selection/followDroneId slices are added now (null) so `updateLiveLayers` can read them, but nothing populates them until 1D. Ticker click-through and coverage-highlight-on-selection are wired to read selection but stay inert until 1D populates it.

**Placeholder scan:** No TBD/TODO. Transcription tasks cite exact legacy line ranges + rules; new React/store code and all test code are given in full.

**Type consistency:** `Engine` (from domain) used in `EngineContext`/`useSimEngine`/builders/`computeCounts`. `Selection`/`GridStats` defined in `store.ts` (Task 1), consumed by `liveFeatures`/`updateLiveLayers` (Task 2), `useLiveLayers`/`computeCounts` (Task 3), `GridStats` (Task 4). `TickerEvent` defined in `store.ts` (Task 4), produced by `mapEngineEvent` (Task 4), consumed by `Ticker`. `createLiveLayerUpdater`/`update` signature consistent between `updateLiveLayers.ts` (Task 2) and `useLiveLayers` (Task 3). `fxPulses`/`pushLaunchPulse` names consistent between `fx.ts` (Task 2), `usePingDriver` (Task 2 edit), and `EngineProvider` (Task 3).
