# Phase 1A: Core Domain Port (framework-free TS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the framework-free simulation core (engine, router, data, geo) from vanilla JS to strict TypeScript ES modules under `app/src/modules/console/domain/`, carrying all existing unit tests over to Vitest, with zero behavior change.

**Architecture:** This is a faithful 1:1 PORT, not a redesign. Each source file in `assets/js/sim/` and `assets/js/data/` becomes a typed ES module. The current "attach to `window`/`globalThis`" IIFE idiom and the engine's service-locator pattern (reading `SimRouter`/`MISSIONS_CONFIG`/`DOCK_RANGE` off the global object) are replaced by explicit `import`/`export`. Logic is transcribed line-for-line; only module wiring and type annotations are added. The ported tests (same assertions) are the correctness gate — if they pass, the port is faithful. No UI, no React, no MapLibre in this phase.

**Tech Stack:** TypeScript 5 (strict), Vitest 2, ES modules. Target directory `app/src/modules/console/domain/`.

## Global Constraints

- **Faithful port, no logic changes.** Transcribe each source file's logic exactly. Do not "improve", refactor, rename public members, or change numeric constants, string literals, event copy, or control flow. The only permitted changes are: IIFE→ES module, global reads→imports, and added type annotations. — spec §8.1 "ported nearly 1:1".
- **All new code lives under `app/src/modules/console/domain/`.** Do not modify the legacy `assets/js/` sources or the legacy `tests/*.test.js` — they stay the live site's code until Phase 1 completes. — Phase 0 invariant (legacy stays live).
- **Strict TypeScript.** `app/tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` all on. Ported code must pass `tsc --noEmit` with zero errors and zero `any` escapes except where explicitly noted (GeoJSON blobs).
- **Tests carry over to Vitest**, one ported `.test.ts` per legacy `.test.js`, same test names and same assertions. Use this assertion mapping verbatim:
  - `const test = require('node:test')` / `const assert = require('node:assert')` → `import { describe, it, expect } from 'vitest'`
  - `require('../assets/js/...')` global-attach load → `import { X } from '../<module>'` (named imports)
  - `test('name', () => {...})` → `it('name', () => {...})` (wrap each file's tests in one `describe('<module>', () => {...})`)
  - `assert.equal(a, b)` / `assert.strictEqual(a, b)` → `expect(a).toBe(b)`
  - `assert.deepEqual(a, b)` / `assert.deepStrictEqual(a, b)` → `expect(a).toEqual(b)`
  - `assert.ok(x)` → `expect(x).toBeTruthy()`
  - `assert(x)` → `expect(x).toBeTruthy()`
  - `assert.throws(fn, /regex/)` → `expect(fn).toThrow(/regex/)`
  - `assert.doesNotThrow(fn)` → `expect(fn).not.toThrow()`
- **Seed and determinism preserved.** The engine's PRNG is `mulberry32(42)`; time advances only via the caller-supplied `dt` in `tick(dt)`. Do not introduce `Date.now()`, `Math.random()`, `performance`, timers, or `requestAnimationFrame` anywhere in this phase. (Router's `atob` jitter branch currently calls `Math.random()`; keep it exactly as-is — it is unused by the engine.)
- **npm scripts on this Windows checkout:** the repo path contains `&`, which breaks npm's default cmd script-shell. Run all `npm run ...`/`npm test` via the Bash tool with `export npm_config_script_shell=bash` first, from `app/`. Quote paths.
- **Console voice unaffected** (no UI copy in this phase), but preserve every event `message`/`code` string byte-for-byte since tests and later UI phases match on them.

---

### Task 1: Domain types + docks module + docks tests

**Files:**
- Create: `app/src/modules/console/domain/types.ts`
- Create: `app/src/modules/console/domain/docks.ts`
- Test: `app/src/modules/console/domain/docks.test.ts`
- Source refs: `assets/js/data/docks.js` (175 lines), `assets/js/sim/engine.js` (for state-union derivation), `tests/docks.test.js` (21 lines)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `types.ts` exports the domain interfaces used by every later task: `LonLat`, `Dock`, `Drone`, `Mission`, `FlightRequest`, `Track`, `SimEvent`, and the state unions `DockState`, `DroneState`, `MissionState`, `RequestStatus`, `TrackStatus`, `Priority`, `MissionType`.
  - `docks.ts` exports `DATA_DOCKS: DockSeed[]` (104 entries) and `DOCK_RANGE` with `URBAN_RANGE_KM: 3`, `RURAL_RANGE_KM: 5`, `URBAN_CENTERS`, `isUrbanDock(d): boolean`, `dockRangeKm(d): 3 | 5`. `DockSeed` (the raw input shape) is exported from `types.ts`.

- [ ] **Step 1: Derive the exact state unions from the source**

Run (from repo root, Bash):
```bash
grep -oE "\.state = '[a-z-]+'" "assets/js/sim/engine.js" | sort -u
grep -oE "status = '[a-z]+'|status: '[a-z]+'" "assets/js/sim/engine.js" | sort -u
grep -oE "priority[: ]=? '[A-Z]+'" "assets/js/sim/engine.js" | sort -u
```
Expected: enumerates every literal assigned to `drone.state`/`dock.state`, `req.status`/`track.status`, and priorities. Use the results to fill the unions in Step 2 (baseline below must be widened if grep shows more).

- [ ] **Step 2: Write `types.ts`**

Baseline unions (widen only if Step 1's grep reveals additional literals; never narrow):

```ts
export type LonLat = [lon: number, lat: number]

export type MissionType =
  | 'security' | 'infra' | 'emergency' | 'delivery'
  | 'construction' | 'highway' | 'parks'

export type DockState =
  | 'ready' | 'launching' | 'drone-away' | 'landing'
  | 'charging' | 'fault' | 'offline'

export type DroneState =
  | 'docked' | 'takeoff' | 'enroute' | 'onstation' | 'returning' | 'landing'

export type MissionState = 'active' | 'complete'
export type RequestStatus = 'pending' | 'approved' | 'declined' | 'completed'
export type TrackStatus = 'active' | 'tasked' | 'resolved' | 'expired'
export type Priority = 'ROUTINE' | 'PRIORITY' | 'URGENT'

// Raw dock input as it appears in DATA_DOCKS (data/docks.js entries).
export interface DockSeed {
  id: string
  name: string
  emirate: string
  coords: LonLat
  model: string
  urban?: boolean
}

export interface Drone {
  id: string
  model: string
  dockId: string
  pos: LonLat
  alt: number
  heading: number
  speedMs: number
  battery: number
  state: DroneState
  missionId: string | null
  _leg: unknown
  _legDistKm: number
  _legProgress: number
  _timer: number
  _holdUntil: number
}

export interface Dock {
  id: string
  name: string
  emirate: string
  coords: LonLat
  urban: boolean | undefined
  battery: number
  state: DockState
  drone: Drone
  _faultUntil: number
  _allDocks?: Dock[]
}

export interface Mission {
  id: string
  type: MissionType
  dockId: string
  waypoints: LonLat[]
  params: { altM: number; speedMs: number }
  progress: number
  state: MissionState
  analytics: Record<string, unknown> | null
  startedAt: number
  distanceKm: number
  durationS: number
  completedAt?: number
  requestId?: string
  trackId?: string
  _milestones: Record<string, unknown>
}

export interface FlightRequest {
  id: string | null
  customer: string
  customerFull: string
  type: MissionType
  place: string
  coords: LonLat
  priority: Priority
  params: { altM: number; speedMs: number }
  requestedAt: number
  status: RequestStatus
  dockId: string
  waypoints: LonLat[] | null
  missionId: string | null
}

export interface Track {
  id: string
  label: string
  missionType: MissionType
  pos: LonLat
  sourceDrone: string
  sourceMission: string
  detectedAt: number
  expiresAt: number
  status: TrackStatus
  missionId: string | null
  dockId: string | null
  homeDockId: string
}

export interface SimEvent {
  time: number
  level: 'info' | 'warn' | 'alert'
  source: string
  message: string
  code?: string
  // C-2 extras merged onto the event (e.g. dockId, requestId, trackId).
  dockId?: string
  requestId?: string
  trackId?: string
}
```
(If Step 1's grep shows a `level` value other than info/warn/alert, widen `SimEvent.level` to match.)

- [ ] **Step 3: Write `docks.ts`**

Port `assets/js/data/docks.js` verbatim:
- Copy the `URBAN_RANGE_KM`, `RURAL_RANGE_KM`, `URBAN_CENTERS` constants and the `isUrbanDock`/`dockRangeKm` function bodies exactly.
- Copy the entire `DATA_DOCKS` array literal (all 104 entries) verbatim — do not retype coordinates.
- Replace the IIFE wrapper and `g.DOCK_RANGE = ...` / `g.DATA_DOCKS = ...` with:
  ```ts
  import type { DockSeed, LonLat } from './types'
  ```
  and `export const DATA_DOCKS: DockSeed[] = [ ...verbatim... ]`, `export const DOCK_RANGE = { URBAN_RANGE_KM: 3, RURAL_RANGE_KM: 5, URBAN_CENTERS, isUrbanDock, dockRangeKm } as const` (or export each member; match whatever the tests import).
- Type `isUrbanDock(dock: { coords: LonLat; urban?: boolean }): boolean` and `dockRangeKm(dock: { coords: LonLat; urban?: boolean }): 3 | 5`. Type `URBAN_CENTERS` as `{ name: string; lon: number; lat: number; rKm: number }[]`.

- [ ] **Step 4: Port `docks.test.ts`**

Port `tests/docks.test.js` using the assertion mapping in Global Constraints. Import `{ DATA_DOCKS }` (and `DOCK_RANGE` if used) from `./docks`. Keep the three test names and assertions identical (count === 104, id-regex/shape, emirate distribution).

- [ ] **Step 5: Run the ported test (expect PASS) and typecheck**

Run (from `app/`, with `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/docks.test.ts
npm run typecheck
```
Expected: docks tests pass (3/3); `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/console/domain/types.ts app/src/modules/console/domain/docks.ts app/src/modules/console/domain/docks.test.ts
git commit -m "feat: port domain types + docks module to TS (Phase 1A)"
```

---

### Task 2: Sites, missions-config, video-manifest modules + sites tests

**Files:**
- Create: `app/src/modules/console/domain/sites.ts`
- Create: `app/src/modules/console/domain/missions-config.ts`
- Create: `app/src/modules/console/domain/video-manifest.ts`
- Test: `app/src/modules/console/domain/sites.test.ts`
- Source refs: `assets/js/data/sites.js` (30), `assets/js/data/missions-config.js` (18), `assets/js/data/video-manifest.js` (15), `tests/sites.test.js` (39)

**Interfaces:**
- Consumes: `types.ts` from Task 1 (`LonLat`, `MissionType`).
- Produces:
  - `sites.ts` exports `DATA_SITES: Site[]` (19 entries); `Site` interface `{ id: string; name: string; coords: LonLat; status: 'installed' | 'not-installed' | 'replace' }` — add `Site` to `types.ts`.
  - `missions-config.ts` exports `MISSIONS_CONFIG: Record<MissionType, MissionConfig>` where `MissionConfig = { label: string; pattern: 'perimeter' | 'corridor' | 'atob' | 'lawnmower'; defaults: { altM: number; speedMs: number }; analytics: (mission: Mission, rand: () => number) => Record<string, unknown> }` — add `MissionConfig` to `types.ts`.
  - `video-manifest.ts` exports `VIDEO_MANIFEST: Record<MissionType, string[]>`.

- [ ] **Step 1: Add `Site` and `MissionConfig` to `types.ts`**

Append to `types.ts`:
```ts
export interface Site {
  id: string
  name: string
  coords: LonLat
  status: 'installed' | 'not-installed' | 'replace'
}

export interface MissionConfig {
  label: string
  pattern: 'perimeter' | 'corridor' | 'atob' | 'lawnmower'
  defaults: { altM: number; speedMs: number }
  analytics: (mission: Mission, rand: () => number) => Record<string, unknown>
}
```
(If the source `pattern` values differ, match the source exactly.)

- [ ] **Step 2: Write `sites.ts`**

Port `assets/js/data/sites.js` verbatim: copy the `DATA_SITES` array (all 19 entries), replace IIFE/global-attach with `import type { Site } from './types'` and `export const DATA_SITES: Site[] = [ ...verbatim... ]`.

- [ ] **Step 3: Write `missions-config.ts`**

Port `assets/js/data/missions-config.js` verbatim: copy all 7 mission-type configs including the `analytics` function bodies exactly. Replace IIFE/global-attach with `import type { MissionType, MissionConfig } from './types'` and `export const MISSIONS_CONFIG: Record<MissionType, MissionConfig> = { ...verbatim... }`.

- [ ] **Step 4: Write `video-manifest.ts`**

Port `assets/js/data/video-manifest.js` verbatim: `import type { MissionType } from './types'` and `export const VIDEO_MANIFEST: Record<MissionType, string[]> = { ...verbatim... }`.

- [ ] **Step 5: Port `sites.test.ts`**

Port `tests/sites.test.js` per the assertion mapping. Import `{ DATA_SITES }` from `./sites`. Keep all three test names and assertions identical (id set matches the 19 ids, 13/4/2 status distribution, lon/lat within UAE bbox).

- [ ] **Step 6: Run tests + typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/sites.test.ts
npm run typecheck
```
Expected: sites tests pass (3/3); tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/console/domain/sites.ts app/src/modules/console/domain/missions-config.ts app/src/modules/console/domain/video-manifest.ts app/src/modules/console/domain/sites.test.ts app/src/modules/console/domain/types.ts
git commit -m "feat: port sites, missions-config, video-manifest to TS (Phase 1A)"
```

---

### Task 3: Geo data modules + geo tests

**Files:**
- Create: `app/src/modules/console/domain/geo-uae.ts`
- Create: `app/src/modules/console/domain/geo-world.ts`
- Test: `app/src/modules/console/domain/geo.test.ts`
- Source refs: `assets/js/data/geo-uae.js` (~9.8 KB minified), `assets/js/data/geo-world.js` (~202 KB minified), `tests/geo.test.js` (22)

**Interfaces:**
- Consumes: `types.ts` (only for `LonLat` if needed).
- Produces:
  - `geo-uae.ts` exports `GEO_UAE: { borders: FeatureCollection; roads: FeatureCollection; places: FeatureCollection }`.
  - `geo-world.ts` exports `GEO_WORLD: FeatureCollection`.
  - Both typed with GeoJSON types via the `geojson` type package.

- [ ] **Step 1: Add the GeoJSON types dependency**

Run (from `app/`):
```bash
npm install -D @types/geojson@^7946.0.15
```
Expected: `@types/geojson` added to devDependencies (provides the `geojson` module's `FeatureCollection`, `Feature`, etc. as ambient types).

- [ ] **Step 2: Write `geo-uae.ts`**

Copy the minified GeoJSON object literal from `assets/js/data/geo-uae.js` verbatim. Replace the IIFE/global-attach with:
```ts
import type { FeatureCollection } from 'geojson'
export const GEO_UAE: { borders: FeatureCollection; roads: FeatureCollection; places: FeatureCollection } = { /* verbatim */ }
```
Do not reformat or re-minify the data; paste the object body exactly.

- [ ] **Step 3: Write `geo-world.ts`**

Copy the minified GeoJSON from `assets/js/data/geo-world.js` verbatim:
```ts
import type { FeatureCollection } from 'geojson'
export const GEO_WORLD: FeatureCollection = { /* verbatim */ }
```

- [ ] **Step 4: Port `geo.test.ts`**

Port `tests/geo.test.js` per the assertion mapping. Import `{ GEO_WORLD }` from `./geo-world` and `{ GEO_UAE }` from `./geo-uae`. Keep the three test names and assertions identical (FeatureCollection shape, feature counts, roads bbox check).

- [ ] **Step 5: Run tests + typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/geo.test.ts
npm run typecheck
```
Expected: geo tests pass (3/3); tsc clean. If `tsc` complains about the GeoJSON literal not matching `FeatureCollection` (e.g. `geometry.type` widened to `string`), add `as FeatureCollection` to the literal — this is the one sanctioned type assertion in this phase (large third-party-shaped data blob).

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/console/domain/geo-uae.ts app/src/modules/console/domain/geo-world.ts app/src/modules/console/domain/geo.test.ts app/package.json app/package-lock.json
git commit -m "feat: port UAE + world geo data to TS (Phase 1A)"
```

---

### Task 4: Router module + router tests

**Files:**
- Create: `app/src/modules/console/domain/router.ts`
- Test: `app/src/modules/console/domain/router.test.ts`
- Source refs: `assets/js/sim/router.js` (71), `tests/router.test.js` (33)

**Interfaces:**
- Consumes: `types.ts` (`LonLat`).
- Produces: `router.ts` exports `SimRouter` with: `offsetMeters(p: LonLat, dxM: number, dyM: number): LonLat`, `distM(a: LonLat, b: LonLat): number`, `pathLengthKm(coords: LonLat[]): number`, `bearing(a: LonLat, b: LonLat): number`, `lawnmower(center: LonLat, widthKm: number, heightKm: number, spacingM: number, bearingDeg: number): LonLat[]`, `orbit(center: LonLat, radiusM: number, points?: number): LonLat[]`, `perimeter(center: LonLat, radiusM: number, points?: number): LonLat[]`, `atob(from: LonLat, to: LonLat, viaJitterM?: number): LonLat[]`, `corridor(polyline: LonLat[], startFrac: number, lengthKm: number): LonLat[]`, `pointAlong(coords: LonLat[], frac: number): { pos: LonLat; heading: number }`. Export the same `SimRouter` object the engine imports, and also each function as a named export if the tests import them individually.

- [ ] **Step 1: Write `router.ts`**

Port `assets/js/sim/router.js` verbatim — every function body copied exactly (equirectangular math, `orbit` returns a closed ring, `perimeter` aliases `orbit`, `atob`'s `Math.random()` jitter branch kept unchanged). Replace IIFE/global-attach with `import type { LonLat } from './types'` and export a `SimRouter` object plus named function exports. Add the parameter/return types from the Interfaces block above; do not alter any arithmetic.

- [ ] **Step 2: Port `router.test.ts`**

Port `tests/router.test.js` per the assertion mapping. Import from `./router` (check whether the legacy test reads `globalThis.SimRouter.fn` or destructures — either way import the same functions). Keep all five test names and assertions identical (offsetMeters, lawnmower, orbit closure, corridor, pointAlong heading).

- [ ] **Step 3: Run tests + typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/router.test.ts
npm run typecheck
```
Expected: router tests pass (5/5); tsc clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/modules/console/domain/router.ts app/src/modules/console/domain/router.test.ts
git commit -m "feat: port SimRouter to TS (Phase 1A)"
```

---

### Task 5: Engine module + engine core tests

**Files:**
- Create: `app/src/modules/console/domain/engine.ts`
- Test: `app/src/modules/console/domain/engine.test.ts`
- Source refs: `assets/js/sim/engine.js` (1354), `tests/engine.test.js` (249)

**Interfaces:**
- Consumes: `router.ts` (`SimRouter`), `missions-config.ts` (`MISSIONS_CONFIG`), `docks.ts` (`DOCK_RANGE`), `types.ts` (all entity types).
- Produces: `engine.ts` exports `SimEngine = { create, mulberry32 }` and an `Engine` interface. Public engine method signatures (return types per the source):
  - `create(opts?: { docks?: DockSeed[]; roads?: FeatureCollection; now?: number }): Engine`
  - `mulberry32(seed: number): () => number`
  - `Engine` members: `now: number`, `docks: Map<string, Dock>`, `drones: Map<string, Drone>`, `missions: Map<string, Mission>`, `requests: Map<string, FlightRequest>`, `tracks: Map<string, Track>`, `events: SimEvent[]`, `roads: FeatureCollection`, `rand: () => number`, `airborneTarget: number`, `onEvent(cb: (ev: SimEvent) => void): (ev: SimEvent) => void`, `tick(dt: number): void`, `createMission(spec): Mission`, `launchPreset(type, opts?): Mission`, `approveRequest(id): Mission`, `declineRequest(id): boolean`, `taskTrack(id): Mission`, `dismissTrack(id): boolean`, `commandRTB(id): boolean`, `commandHold(id, on): boolean`, `setManual(id, on): boolean`, `manualGoto(id, lonlat): boolean`, `manualQueue(id, lonlat): boolean`, `nudgeAlt(id, delta): boolean`. Type the private `_`-prefixed accumulator fields too (all `number` except `_subscribers: ((ev: SimEvent) => void)[]`).

- [ ] **Step 1: Write `engine.ts` — module wiring and imports**

Create `engine.ts`. At the top:
```ts
import { SimRouter } from './router'
import { MISSIONS_CONFIG } from './missions-config'
import { DOCK_RANGE } from './docks'
import type {
  Dock, Drone, Mission, FlightRequest, Track, SimEvent, DockSeed, MissionType, LonLat,
} from './types'
import type { FeatureCollection } from 'geojson'
```
Then transcribe the module-scope constants and helpers (`assets/js/sim/engine.js` lines ~1-222: `EVENTS_CAP`, `AIRBORNE_TARGET`, `TAKEOFF_S`, `LANDING_S`, `RANGE_TOLERANCE`, `REQUEST_FIRST_S`, `TRACK_TTL_S`, `TRACK_LABELS`, `isFiniteXY`, `mulberry32`, and any other module-closure helpers) verbatim. Inside `create()`, DELETE the two service-locator lines (`const R = (window||globalThis).SimRouter` and the `MISSIONS_CONFIG` global read at source lines 225-226) and instead use the imported `SimRouter` (bind `const R = SimRouter` to keep the rest of the body unchanged) and the imported `MISSIONS_CONFIG`. Wherever the engine reads `DOCK_RANGE` off the global, use the imported `DOCK_RANGE`. Transcribe the entire `create()` body (source ~223-1350) line-for-line otherwise.

- [ ] **Step 2: Add type annotations without changing logic**

Annotate the `engine` object as `Engine`, the `Map`s with their entity generics, function parameters and returns per the Interfaces block, and the local entity literals (`drone`, `dock`, `mission`, `request`, `track`) with their interface types. Where the source uses `null` initial values later reassigned (e.g. `mission.analytics = null`), the interfaces already allow it. Do not add runtime code; annotations only. Resolve strict-mode complaints (e.g. `noUnusedParameters`) by prefixing intentionally-unused params with `_`, matching existing source intent — but do not delete parameters that are part of a public signature.

- [ ] **Step 3: Port `engine.test.ts`**

Port `tests/engine.test.js` per the assertion mapping. The legacy test builds an engine via `SimEngine.create({ docks: [...], roads: ... })` — import `{ SimEngine }` from `./engine` and any data it uses (e.g. a small hand-built dock list, or `DATA_DOCKS`) from the domain modules. Keep all 13 test names and assertions identical. If the legacy test relies on `MISSIONS_CONFIG`/`SimRouter` being on `globalThis` (because the source engine read them from there), import them and pass/use them as the ported engine now expects — the engine no longer needs globals, so the test should not set any.

- [ ] **Step 4: Run engine tests + full typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/engine.test.ts
npm run typecheck
```
Expected: engine tests pass (13/13); `tsc --noEmit` clean across the whole domain.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/console/domain/engine.ts app/src/modules/console/domain/engine.test.ts app/src/modules/console/domain/types.ts
git commit -m "feat: port SimEngine to TS with explicit imports (Phase 1A)"
```

---

### Task 6: Port remaining engine subsystem test suites

**Files:**
- Test: `app/src/modules/console/domain/range.test.ts`
- Test: `app/src/modules/console/domain/requests.test.ts`
- Test: `app/src/modules/console/domain/tracks.test.ts`
- Source refs: `tests/range.test.js` (205), `tests/requests.test.js` (255), `tests/tracks.test.js` (372)

**Interfaces:**
- Consumes: `engine.ts`, `docks.ts` (`DOCK_RANGE`), and whatever data/helpers the legacy suites build. No new production code — this task only ports tests, which is why it is separated from Task 5 (a reviewer can approve the engine port yet reject a test-port mistake).
- Produces: three ported Vitest suites; the full domain suite passes.

- [ ] **Step 1: Port `range.test.ts`**

Port `tests/range.test.js` per the assertion mapping. Import `{ SimEngine }` from `./engine`, `{ DOCK_RANGE }` from `./docks`. This suite exercises DOCK_RANGE classification and the engine C-1/C-2 contracts (waypoint-outside-coverage rejection with the `WAYPOINT OUTSIDE COVERAGE` message, in-range acceptance, manual clamp, `launchPreset`, and event `code`/`level` semantics — `MISSION_LAUNCHED`, forced-RTB/fault at level `alert`). Keep all 10 test names and assertions identical. Recreate any `mkIsolated`/single-dock helper the legacy file defines, in TS.

- [ ] **Step 2: Run range tests**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/domain/range.test.ts
```
Expected: 10/10 pass.

- [ ] **Step 3: Port `requests.test.ts`**

Port `tests/requests.test.js` per the assertion mapping. Import `{ SimEngine }` from `./engine`. Covers R-1..R-3: request spawn timing/id sequence (`REQ-101` first), pending/map caps, request shape, urgent-priority invariant, approve/decline, re-plan on busy dock, dock reservation. Recreate the legacy helpers in TS. Keep all 13 test names and assertions identical.

- [ ] **Step 4: Run requests tests**

Run:
```bash
npm run test -- src/modules/console/domain/requests.test.ts
```
Expected: 13/13 pass.

- [ ] **Step 5: Port `tracks.test.ts`**

Port `tests/tracks.test.js` per the assertion mapping. Import `{ SimEngine }` from `./engine`. Covers T-1/T-2: detection spawn shape, eligible types, active-count cap, event ordering (DETECTION → TRACK_NEW), expiry, map pruning, `taskTrack` dock selection, reservation skip, dismiss, full resolve lifecycle, airborne-divert fallback. Recreate the `mkIsolated`/`syntheticTrack` helpers in TS. Keep all 16 test names and assertions identical.

- [ ] **Step 6: Run the FULL domain suite + typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test
npm run typecheck
```
Expected: the entire domain suite passes — docks 3 + sites 3 + geo 3 + router 5 + engine 13 + range 10 + requests 13 + tracks 16 + the Phase 0 `routerBasename` 3 = **69 tests, all green**; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/console/domain/range.test.ts app/src/modules/console/domain/requests.test.ts app/src/modules/console/domain/tracks.test.ts
git commit -m "test: port engine range/requests/tracks suites to Vitest (Phase 1A)"
```

---

### Task 7: Domain barrel export + public API doc

**Files:**
- Create: `app/src/modules/console/domain/index.ts`
- Create: `app/src/modules/console/domain/README.md`

**Interfaces:**
- Consumes: every module from Tasks 1-5.
- Produces: `index.ts` re-exporting the domain's public surface (`SimEngine`, `SimRouter`, `DOCK_RANGE`, `DATA_DOCKS`, `DATA_SITES`, `MISSIONS_CONFIG`, `VIDEO_MANIFEST`, `GEO_UAE`, `GEO_WORLD`, and all types) so later React phases import from `@/modules/console/domain` rather than deep paths. This is the contract Phase 1B+ consumes.

- [ ] **Step 1: Write `index.ts`**

```ts
export { SimEngine } from './engine'
export type { Engine } from './engine'
export { SimRouter } from './router'
export { DOCK_RANGE, DATA_DOCKS } from './docks'
export { DATA_SITES } from './sites'
export { MISSIONS_CONFIG } from './missions-config'
export { VIDEO_MANIFEST } from './video-manifest'
export { GEO_UAE } from './geo-uae'
export { GEO_WORLD } from './geo-world'
export type * from './types'
```
(Adjust named exports to match the actual export names finalized in earlier tasks.)

- [ ] **Step 2: Write `README.md`**

Document, in a short table: each exported symbol, its type/signature, and a one-line description. Note that this is the framework-free domain consumed by the React UI phases, that time advances only via `engine.tick(dt)`, and that all randomness is the seeded `engine.rand`. State the test command (`npm run test` from `app/`) and the current count (69 tests).

- [ ] **Step 3: Verify the barrel compiles and the suite is green**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run typecheck && npm run lint && npm run test
```
Expected: tsc clean, lint 0 problems (the barrel has no unused exports flagged since they are exports), 69 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/modules/console/domain/index.ts app/src/modules/console/domain/README.md
git commit -m "feat: domain barrel export + public API doc (Phase 1A)"
```

---

## Self-Review

**Spec coverage (spec §8.1 Phase 1, the framework-free core portion):**
- "Engine/router stay framework-free TS (ported nearly 1:1)" → Tasks 4 (router) + 5 (engine), faithful-port constraint enforced.
- "unit tests carried over" → Tasks 1-6 port all 7 legacy suites to Vitest with the exact assertion mapping; Task 6 Step 6 asserts the full count (69).
- Data/geo modules the engine and later map need → Tasks 1-3.
- Repo layout `app/src/modules/console/` → all files under `app/src/modules/console/domain/`, matching spec §3.
- Range model reuse (spec §4 mentions a typed range model) → `DOCK_RANGE` ported in Task 1; a later planner phase can import or re-implement from it.
- Legacy stays deployed until parity → this phase adds only `app/` files; legacy `assets/js` and `tests/` untouched (Global Constraints).

**Explicitly out of Phase 1A scope (later sub-plans):** the MapLibre `<MapView>` wrapper, globe/scene, live engine-to-map binding, panels/control/UI, mission videos playback, deploy flip. This phase produces a headless, tested domain only.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Port tasks intentionally reference the source file plus a precise transformation recipe rather than re-pasting 1354 lines of engine or 104 dock literals — this is a faithful-port plan, and the ported tests are the correctness gate. The genuinely new artifact (the type definitions) is given in full.

**Type consistency:** `types.ts` defines `LonLat`, `Dock`, `Drone`, `Mission`, `FlightRequest`, `Track`, `SimEvent`, `Site`, `MissionConfig`, `DockSeed`, and the unions; every later task imports these exact names. `SimEngine.create`/`mulberry32` names match between Task 5 (definition) and Task 6 (test imports). `DOCK_RANGE`/`DATA_DOCKS`/`DATA_SITES`/`MISSIONS_CONFIG`/`VIDEO_MANIFEST`/`GEO_UAE`/`GEO_WORLD` names are consistent across their defining task and the Task 7 barrel.
