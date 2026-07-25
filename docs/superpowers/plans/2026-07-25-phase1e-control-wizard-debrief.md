# Phase 1E: Manual Control, Mission Wizard, Debrief, Media, Request + Track Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill every Phase 1E seam left by Phase 1D so the React console reaches feature parity with the legacy vanilla app: manual drone control (banner, click-to-fly, queued waypoints, alt nudges), the three-step mission wizard, the predefined MISSIONS dropdown, the mission debrief panel (route snapshot, analytics, video / animated placeholder, report export), the MEDIA library, the flight-request review panel, and the detection-track review panel with its map interactions.

**Architecture:** Legacy `assets/js/ui/control.js` (856 lines) owns a `control` object (`mode`, `activeId`, `wizard`, `userMissions`) that every other lane consults via `EC2.control.mode !== 'normal'`. In React that object becomes a `control` slice on the Zustand store, and Phase 1D's `inCaptureMode()` — currently a hardcoded `false` with every call site already in place — starts reading it. Manual control and the wizard each get a directory under `app/src/modules/console/control/`; the remaining right-panel modes join `app/src/modules/console/panels/` and are added to `RightPanelState`'s union and `RightPanel.tsx`'s switch. Imperative map writes (the `manual-wpts` and `wizard-preview` sources, both already in the Phase 1B style) go through `source.setData` exactly as legacy did, gated on MapView's `ready` latch.

**Tech Stack:** React 18, TypeScript (strict), MapLibre GL v5, Zustand, the Phase 1A domain + 1B map + 1C engine binding + 1D chrome, Vitest (+ jsdom via per-file `@vitest-environment jsdom` pragma).

## Global Constraints

- **Faithful 1:1 port** of `assets/js/ui/control.js` and the remaining parts of `assets/js/ui/panels.js`. Transcribe logic, numeric constants, thresholds, glyphs, class names, element ids and UI copy exactly. Only module wiring, types, and the DOM-painting mechanism (innerHTML -> JSX) may change.
- **No `any`.** TypeScript strict; `npm run lint` runs `--max-warnings 0`.
- **No `escapeHtml`.** JSX escapes text children by construction.
- **No em dashes in UI prose.** Mono micro-labels are 9.5px / `.22em` / uppercase (`.lbl`). Red `#ff5a5a` / `#BC0000` is reserved for brand + alerts.
- **Legacy HTML entities become real characters in JSX:** `&middot;` -> `·`, `&deg;` -> `°`, `&amp;` -> `&`, `&mdash;` -> `—`, `&#10003;` -> `✓`.
- **FILE NAMING HAZARD:** this checkout's filesystem is case-insensitive. NEVER create two files in one directory whose names differ only by case (`foo.ts` + `Foo.tsx`) — module resolution silently picks the wrong one. Suffix the pure-model file (`wizardModel.ts` next to `WizardPanel.tsx`) instead.
- **Map readiness gates on `useMap().ready`,** never `map.loaded()`.
- **Per-frame map updates stay imperative.** The wizard preview and manual waypoint layers use `getSource(id).setData(...)`, never React state.
- **All timers, rAF handles, map listeners and engine subscriptions live in effects with cleanup.** Engine subscriptions unsubscribe via `engine.offEvent(cb)`.
- **Legacy stays live.** Only `app/` is touched. Do not edit `assets/`, `console.html`, `index.html`, or `.github/workflows/deploy.yml` (Phase 1F owns the deploy).
- **npm on this Windows checkout:** the repo path contains `&`. Run npm from `app/` via Bash with `export npm_config_script_shell=bash`. The pre-commit hook does NOT typecheck — run `npm run typecheck` yourself.
- **Browser verification uses the Playwright MCP, not the preview pane.** Dev server: `npm run dev` from `app/`, then `http://localhost:5173/console` — note the dev base is `/`, so `/e-Sentinel/console` is a blank no-route-matched page in dev. Preview (`npm run preview`, port 4173) DOES use `/e-Sentinel/`.
- Import shared/domain/map/engine/chrome code via the `@/` alias.

---

## File Structure

New under `app/src/modules/console/control/`:
`controlModel.ts` (pure predicates + constants), `ManualBanner.tsx`, `useManualControl.ts`, `useCaptureMapClicks.ts`, `useCaptureKeys.ts`, `wizardModel.ts`, `WizardPanel.tsx`, `useWizardPreview.ts`, `MissionsMenu.tsx`, `presets.ts`, `control.css`.

New under `app/src/modules/console/panels/`:
`debriefModel.ts`, `DebriefPanel.tsx`, `RouteSvg.tsx`, `DebriefVideo.tsx`, `mediaModel.ts`, `MediaPanel.tsx`, `RequestPanel.tsx`, `trackModel.ts`, `TrackPanel.tsx`.

Modified: `shared/store.ts`, `panels/RightPanel.tsx`, `panels/panels.css`, `panels/DockPanel.tsx`, `panels/DroneTelemetryPanel.tsx`, `panels/OpsDigestPanel.tsx`, `selection/selectEntity.ts`, `chrome/Topbar.tsx`, `chrome/RequestBoard.tsx`, `chrome/DockList.tsx`, `hud/Ticker.tsx`, `engine/useLiveLayers.ts`, `map/MapContext.ts` (or a new updater context), `Console.tsx`.

---

### Task 1: Control-mode store slice, capture-mode plumbing, and updater access

**Files:**
- Modify: `app/src/shared/store.ts`
- Create: `app/src/modules/console/control/controlModel.ts`
- Create: `app/src/modules/console/control/useCaptureKeys.ts`
- Modify: `app/src/modules/console/selection/selectEntity.ts`
- Create: `app/src/modules/console/engine/UpdaterContext.ts`
- Modify: `app/src/modules/console/engine/useLiveLayers.ts`
- Modify: `app/src/modules/console/Console.tsx`
- Modify: `app/src/modules/console/chrome/Topbar.tsx`
- Test: `app/src/modules/console/control/controlModel.test.ts`
- Modify: `app/src/shared/store.test.ts`
- Source refs: `control.js:9-19` (the control object), `:56-84` (updateNewMissionButtonState), `:131-196` (enterManual/cleanupUI/exitManual — mode transitions only, the UI half is Task 2), `:502-529` (enterWizard/exitWizard), `:703-709` (wireKeys), `panels.js:2455-2467` (EC2.select's capture-mode handoff), `panels.js:2636-2638` (inCaptureMode).

**Interfaces:**
- Produces:
  - `store.ts` gains a `control` slice: `controlMode: 'normal' | 'manual' | 'wizard'` (default `'normal'`), `controlActiveId: string | null`, `controlFollowWasAuto: boolean`, `wizard: WizardState | null`, `userMissions: string[]` (an array, not a `Set`, so Zustand equality stays value-based), plus `sessionMissions: Mission[]` (Task 5 fills it; default `[]`). Actions: `setControlMode(mode, activeId)`, `setControlFollowWasAuto(v)`, `setWizard(w)`, `addUserMission(id)`, `pushSessionMission(m)`. `RightPanelState`'s union widens to add `| { mode: 'wizard' } | { mode: 'debrief'; id: string } | { mode: 'media' } | { mode: 'request'; id: string } | { mode: 'track'; id: string }`. Export `WizardState` (defined in Task 3's `wizardModel.ts` and imported here as a type — if that creates a cycle, define `WizardState` in `store.ts` and have `wizardModel.ts` import it; pick one and note it).
  - `controlModel.ts`: `isCaptureMode(mode): boolean`, `newMissionButtonState(mode): { disabled: boolean; title: string }` and `missionsButtonState(mode): { disabled: boolean; title: string }` — the exact disabled/title pairs from `control.js:56-84` (`'UNAVAILABLE DURING MANUAL CONTROL'`, `'MISSION WIZARD ACTIVE'`, `'CREATE A NEW MISSION'`, `'LAUNCH A PREDEFINED MISSION'`).
  - `useCaptureKeys()`: the Escape handler (`control.js:703-709`) — exits manual, else exits the wizard. Takes the two exit callbacks as arguments so it has no import cycle with Tasks 2/3.
  - `UpdaterContext.ts`: a `React.Context<LiveLayerUpdater | null>` + `useUpdater()` returning it (may be null). `useLiveLayers()` gains an optional way to publish its updater instance — the simplest shape is for `useLiveLayers` to accept a setter, or for `Console.tsx` to own the `createLiveLayerUpdater()` instance and pass it into `useLiveLayers`. Choose the latter if it is cleaner; either way `setRangeHighlight(dockId)` must be reachable from the wizard and manual control, which is the whole point (this was recorded as a Phase 1C deferral).
  - `selectEntity.ts`: `inCaptureMode()` now reads `useAppStore.getState().controlMode !== 'normal'`. `selectEntity` gains the legacy handoff at `panels.js:2459-2466`: if manual control is engaged and the new selection is NOT that same drone, call the injected `exitManual`; if the wizard is engaged, call the injected `exitWizard`. Implement this by having `selectEntity.ts` export a `registerCaptureExits({ exitManual, exitWizard })` that `Console.tsx` calls once with the real callbacks (module-level refs defaulting to no-ops) — this keeps `selectEntity` importable from every panel without an import cycle. Document the choice.
  - `Topbar.tsx`: `#btn-newmission` and `#btn-missions` stop being unconditionally disabled and instead read `newMissionButtonState`/`missionsButtonState`. `#btn-newmission` calls the wizard entry (wired in Task 3 via a prop); `#btn-missions` toggles the missions menu (Task 4). Until those land, wire them to props with no-op defaults so this task compiles and reviews on its own.

- [ ] **Step 1: Write the failing `controlModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isCaptureMode, newMissionButtonState, missionsButtonState } from './controlModel'

describe('control model', () => {
  it('isCaptureMode is true for manual and wizard only', () => {
    expect(isCaptureMode('normal')).toBe(false)
    expect(isCaptureMode('manual')).toBe(true)
    expect(isCaptureMode('wizard')).toBe(true)
  })
  it('NEW MISSION button state matches control.js:56-69', () => {
    expect(newMissionButtonState('normal')).toEqual({ disabled: false, title: 'CREATE A NEW MISSION' })
    expect(newMissionButtonState('manual')).toEqual({ disabled: true, title: 'UNAVAILABLE DURING MANUAL CONTROL' })
    expect(newMissionButtonState('wizard')).toEqual({ disabled: true, title: 'MISSION WIZARD ACTIVE' })
  })
  it('MISSIONS button state matches control.js:73-83', () => {
    expect(missionsButtonState('normal')).toEqual({ disabled: false, title: 'LAUNCH A PREDEFINED MISSION' })
    expect(missionsButtonState('manual')).toEqual({ disabled: true, title: 'UNAVAILABLE DURING MANUAL CONTROL' })
    expect(missionsButtonState('wizard')).toEqual({ disabled: true, title: 'MISSION WIZARD ACTIVE' })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `controlModel.ts` to green**

`cd app && export npm_config_script_shell=bash && npm run test -- src/modules/console/control/controlModel.test.ts`

- [ ] **Step 3: Extend the store + its test**

Add the slice and widen `RightPanelState`. Extend `store.test.ts` with defaults + setter isolation assertions in the style already there.

- [ ] **Step 4: Rewire `inCaptureMode`, add `registerCaptureExits`, add `useCaptureKeys`, expose the updater**

Add a test to `selectEntity.test.ts` proving `inCaptureMode()` follows `controlMode` and that selecting a different entity while `controlMode === 'manual'` invokes the registered `exitManual`.

- [ ] **Step 5: Update `Topbar.tsx` + `Console.tsx` wiring; verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/shared/ app/src/modules/console/
git commit -m "feat: control-mode store slice, capture-mode plumbing, updater access (Phase 1E)"
```

---

### Task 2: Manual control

**Files:**
- Create: `app/src/modules/console/control/ManualBanner.tsx`
- Create: `app/src/modules/console/control/useManualControl.ts`
- Create: `app/src/modules/console/control/manualModel.ts`
- Create: `app/src/modules/console/control/control.css`
- Modify: `app/src/modules/console/panels/DroneTelemetryPanel.tsx`
- Test: `app/src/modules/console/control/manualModel.test.ts`
- Source refs: `control.js:26-50` (banner + cursor), `:88-124` (waypointFeatures/refreshWaypoints/clearWaypointLayer/wpPoll), `:131-196` (enterManual/cleanupUI/exitManual), `:685-701` (manual half of wireMapClicks), `:716-732` (wireEngineWatch / MANUAL_RELEASED), `panels.js:610-627` (drone panel's manual button state + forced-release poll), `panels.js:1680-1696` (TAKE CONTROL / RELEASE / ALT +-10 handlers), `console.css:297-306` (.manual-banner, .rp-alt-row).

**Interfaces:**
- Produces:
  - `manualModel.ts` (pure): `waypointFeatures(engine, activeId): FeatureCollection` (`control.js:88-100`, numbered `n: i+1` point features from `drone._manualQueue`), `manualBannerText(droneId): string` (`'MANUAL CONTROL · ' + droneId + ' · CLICK TO FLY · SHIFT+CLICK TO QUEUE'`), `WP_POLL_MS = 300`.
  - `useManualControl()`: returns `{ enterManual(droneId): boolean; exitManual(): void }`. `enterManual` transcribes `control.js:131-167`: bail without an engine, no-op if already manual on that drone, exit a prior manual session, refuse while the wizard holds the map; call `engine.setManual(droneId, true)` and bail if it returns false; set `controlMode`/`controlActiveId`; set the crosshair cursor on `map.getCanvas().style.cursor`; call `updater.setRangeHighlight(drone.dockId)`; auto-enable FOLLOW, recording `controlFollowWasAuto` and easing the camera to the drone (`zoom: 12.5, duration: 600`) only when this call turned it on; start the 300ms waypoint poll. `exitManual` transcribes `:188-196` + `cleanupUI` `:172-183`: release the engine side only when the drone is still in `manual` state, then reset mode/activeId, hide the banner, clear the cursor, stop the poll, clear the `manual-wpts` source, `setRangeHighlight(null)`, and clear `followDroneId` only when `controlFollowWasAuto`. The hook also subscribes to `engine.onEvent` for `code === 'MANUAL_RELEASED'` on the active drone and runs the same cleanup (`control.js:716-732`), unsubscribing via `offEvent`.
  - `ManualBanner.tsx`: `<div id="manual-banner" className="manual-banner" hidden={...}>` with the banner copy, rendered from the store (replaces legacy's imperatively created body child).
  - `control.css`: `.manual-banner` + `.manual-banner[hidden]` from `console.css:297-304`. (`.rp-alt-row` already lives in `panels.css`.)
  - `DroneTelemetryPanel.tsx`: `#rp-control` stops being unconditionally disabled — it now uses `controlDisabled(drone)` and calls `exitManual()` when the drone is in `manual` state, else `enterManual(drone.id)` (`panels.js:1680-1687`). The `#rp-alt-row` `hidden` gate stays `drone.state !== 'manual'`, and `#rp-alt-dn`/`#rp-alt-up` call `engine.nudgeAlt(id, -10 | 10)`. Also port `panels.js:625-627`: if the panel's drone is no longer in `manual` state but the store still says manual control is on it, call `exitManual()`.

- [ ] **Step 1: Write the failing `manualModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { waypointFeatures, manualBannerText } from './manualModel'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
}

describe('manual control model', () => {
  it('banner copy matches control.js:40', () => {
    expect(manualBannerText('D-AUH-001')).toBe(
      'MANUAL CONTROL · D-AUH-001 · CLICK TO FLY · SHIFT+CLICK TO QUEUE',
    )
  })
  it('waypointFeatures is empty without an engine or an active drone', () => {
    expect(waypointFeatures(null, 'D-AUH-001').features).toEqual([])
    const e = bootedEngine()
    expect(waypointFeatures(e, null).features).toEqual([])
  })
  it('numbers each queued waypoint from 1', () => {
    const e = bootedEngine()
    const drone = [...e.drones.values()].find((d) => ['transit', 'on-task'].includes(d.state))
    expect(drone).toBeTruthy()
    expect(e.setManual(drone!.id, true)).toBe(true)
    e.manualQueue(drone!.id, [55.2, 25.1])
    e.manualQueue(drone!.id, [55.3, 25.2])
    const fc = waypointFeatures(e, drone!.id)
    expect(fc.features.length).toBe(2)
    expect(fc.features.map((f) => f.properties?.n)).toEqual([1, 2])
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [55.2, 25.1] })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `manualModel.ts` to green**

- [ ] **Step 3: Implement `useManualControl.ts`, `ManualBanner.tsx`, `control.css`, and the `DroneTelemetryPanel` rewiring**

- [ ] **Step 4: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/control/ app/src/modules/console/panels/
git commit -m "feat: manual drone control (Phase 1E)"
```

---

### Task 3: Mission wizard

**Files:**
- Create: `app/src/modules/console/control/wizardModel.ts`
- Create: `app/src/modules/console/control/WizardPanel.tsx`
- Create: `app/src/modules/console/control/useWizard.ts`
- Test: `app/src/modules/console/control/wizardModel.test.ts`
- Modify: `app/src/modules/console/panels/RightPanel.tsx` (add the `wizard` mode)
- Modify: `app/src/modules/console/panels/panels.css` (add the `.wz-*` rules)
- Modify: `app/src/modules/console/panels/DockPanel.tsx` (enable `#rp-launch`)
- Source refs: `control.js:198-223` (WIZARD_GLYPHS, isLawnmowerType), `:229-272` (wizardBox / wizardLawnmowerPath / wizardFinalWaypoints / wizardStep2Valid / wizardDistanceKm / wizardDurationLabel), `:274-330` (preview features, wizardReadyDocks, wizardNearestReadyDockId), `:336-457` (renderWizard + steps 1/2/3), `:460-485` (handleWizardLaunch), `:490-529` (cleanupWizardUI / enterWizard / exitWizard), `:535-572` (wizardClickOutsideRange / handleWizardMapClick), `:579-681` (wireWizardPanel), `console.css:308-350` (.wz-*) and `:466-471` (.wz-range-warn), `panels.js:1642-1646` (dock panel LAUNCH MISSION -> enterWizard).

**Interfaces:**
- Produces:
  - `wizardModel.ts` (pure, no DOM, no globals — engine/map inputs are parameters): `WIZARD_GLYPHS`, `isLawnmowerType(type)`, `wizardBox(w)`, `wizardLawnmowerPath(w)`, `wizardFinalWaypoints(w)`, `wizardStep2Valid(w)`, `wizardDistanceKm(w)`, `wizardDurationLabel(distKm, speedMs)`, `wizardPreviewFeatures(w)`, `wizardReadyDocks(engine, mapCenter)`, `wizardNearestReadyDockId(engine, mapCenter)`, `wizardClickOutsideRange(engine, w, lonlat): string | null` (returns the warning string instead of mutating `w.rangeWarning`), `applyWizardClick(engine, w, lonlat): WizardState` (the pure state transition from `control.js:545-572`, including the lawnmower derived-corner range check and the reset-after-2-corners rule). `WizardState = { step: 1|2|3; type: MissionType | null; dockId: string | null; points: LonLat[]; spacingM: number; altM: number | null; speedMs: number | null; error: string | null; rangeWarning: string | null }`.
  - `useWizard()`: returns `{ enterWizard(prefillDockId: string | null): boolean; exitWizard(): void; launch(): void; update(patch: Partial<WizardState>): void }`, transcribing `control.js:502-529` and `:460-485`. `enterWizard` refuses while manual control holds the map, sets `controlMode: 'wizard'`, seeds the state (`step 1`, `spacingM 150`, dock = prefill or nearest ready) and opens the wizard panel. `launch` calls `engine.createMission({ type, dockId, waypoints: wizardFinalWaypoints(w), params: { altM, speedMs } })`, on failure stores `error` and pushes a `warn` ticker event `'MISSION LAUNCH FAILED · ' + msg`, on success adds the mission id to `userMissions`, tears the wizard down, sets `followDroneId = 'D-' + dockId` and selects that drone. `exitWizard` tears down, clears the selection and shows the ops digest.
  - `useWizardPreview()` (can live inside `useWizard.ts`): imperatively `setData`s the `wizard-preview` source from `wizardPreviewFeatures(w)` whenever the wizard state changes, and clears it on teardown. Gated on `useMap().ready`.
  - `WizardPanel.tsx`: the three steps as JSX, transcribing every id and class from `control.js:353-450` (`#wz-dock`, `#wz-cancel`, `#wz-next`, `#wz-back`, `#wz-undo`, `#wz-spacing`, `#wz-spacing-val`, `#wz-count`, `#wz-dist`, `#wz-dur`, `#wz-alt`, `#wz-alt-val`, `#wz-speed`, `#wz-speed-val`, `#wz-sum-dur`, `#wz-launch`, `.wz`, `.wz-tiles`, `.wz-tile`, `.wz-glyph`, `.wz-label`, `.wz-field`, `.wz-type-hdr`, `.wz-hint`, `.wz-stats`, `.wz-summary`, `.wz-error`, `.wz-range-warn`) and their exact copy. Slider ranges: spacing 100-300 step 10, altitude 40-120 step 5, speed 5-21 step 1. Legacy patched slider labels imperatively to avoid tearing down the panel mid-drag; in React a controlled `<input type="range">` re-renders only this component per input event, which is equivalent and simpler — do that and note it in a comment. Step transitions set the crosshair cursor and call `updater.setRangeHighlight(dockId)` / `setRangeHighlight(null)` exactly where `control.js` does (`:608-614`, `:623-625`, `:653`, `:661-663`).
  - `DockPanel.tsx`: `#rp-launch` is enabled when the dock state is `'ready'` and calls `enterWizard(dock.id)`.

- [ ] **Step 1: Write the failing `wizardModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE, MISSIONS_CONFIG } from '@/modules/console/domain'
import {
  isLawnmowerType, wizardBox, wizardStep2Valid, wizardDistanceKm,
  wizardDurationLabel, wizardPreviewFeatures, wizardReadyDocks, applyWizardClick,
} from './wizardModel'
import type { WizardState } from './wizardModel'

const base: WizardState = {
  step: 2, type: 'security', dockId: null, points: [], spacingM: 150,
  altM: null, speedMs: null, error: null, rangeWarning: null,
}

describe('wizard model', () => {
  it('isLawnmowerType follows MISSIONS_CONFIG.pattern', () => {
    for (const [type, cfg] of Object.entries(MISSIONS_CONFIG)) {
      expect(isLawnmowerType(type as never)).toBe(cfg.pattern === 'lawnmower')
    }
  })
  it('wizardBox clamps degenerate drags to 0.3km sides (control.js:234-235)', () => {
    const box = wizardBox({ ...base, points: [[55.2, 25.1], [55.2, 25.1]] })
    expect(box).not.toBe(null)
    expect(box!.widthKm).toBeCloseTo(0.3, 5)
    expect(box!.heightKm).toBeCloseTo(0.3, 5)
  })
  it('wizardBox needs two points', () => {
    expect(wizardBox({ ...base, points: [[55.2, 25.1]] })).toBe(null)
  })
  it('step 2 validity: 2 corners for lawnmower, >=2 waypoints otherwise', () => {
    const lawn = Object.entries(MISSIONS_CONFIG).find(([, c]) => c.pattern === 'lawnmower')?.[0]
    expect(wizardStep2Valid({ ...base, points: [[55.2, 25.1]] })).toBe(false)
    expect(wizardStep2Valid({ ...base, points: [[55.2, 25.1], [55.3, 25.2]] })).toBe(true)
    if (lawn) {
      const w = { ...base, type: lawn as never, points: [[55.2, 25.1], [55.3, 25.2], [55.4, 25.3]] as never }
      expect(wizardStep2Valid(w)).toBe(false)
    }
  })
  it('wizardDurationLabel matches control.js:268-272', () => {
    expect(wizardDurationLabel(0, 12)).toBe('--')
    expect(wizardDurationLabel(5, 0)).toBe('--')
    expect(wizardDurationLabel(0.1, 12)).toBe('<1 MIN')
    expect(wizardDurationLabel(12, 10)).toBe('20 MIN')
  })
  it('wizardDistanceKm grows with the clicked path', () => {
    const two = wizardDistanceKm({ ...base, points: [[55.2, 25.1], [55.3, 25.1]] })
    const three = wizardDistanceKm({ ...base, points: [[55.2, 25.1], [55.3, 25.1], [55.4, 25.1]] })
    expect(two).toBeGreaterThan(0)
    expect(three).toBeGreaterThan(two)
  })
  it('preview features are numbered points plus a joining line', () => {
    const fc = wizardPreviewFeatures({ ...base, points: [[55.2, 25.1], [55.3, 25.2]] })
    expect(fc.features.filter((f) => f.geometry.type === 'Point').length).toBe(2)
    expect(fc.features.filter((f) => f.geometry.type === 'LineString').length).toBe(1)
  })
  it('wizardReadyDocks only lists docks whose drone is actually docked', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 600; i++) e.tick(0.5)
    const docks = wizardReadyDocks(e, [54.9, 24.3])
    expect(docks.length).toBeGreaterThan(0)
    expect(docks.every((d) => d.state === 'ready' && d.drone.state === 'docked')).toBe(true)
  })
  it('a third lawnmower click restarts the box (control.js:564)', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    const lawn = Object.entries(MISSIONS_CONFIG).find(([, c]) => c.pattern === 'lawnmower')?.[0]
    if (!lawn) return
    const dock = DATA_DOCKS[0]
    let w: WizardState = { ...base, type: lawn as never, dockId: dock.id, points: [dock.coords, dock.coords] }
    w = applyWizardClick(e, w, dock.coords)
    expect(w.points.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `wizardModel.ts` to green**

- [ ] **Step 3: Implement `useWizard.ts`, `WizardPanel.tsx`, the `.wz-*` CSS, the `RightPanel` wizard mode, and `DockPanel`'s LAUNCH MISSION**

- [ ] **Step 4: Verify + commit**

```bash
git add app/src/modules/console/control/ app/src/modules/console/panels/
git commit -m "feat: three-step mission wizard (Phase 1E)"
```

---

### Task 4: Predefined MISSIONS dropdown

**Files:**
- Create: `app/src/modules/console/control/presets.ts`
- Create: `app/src/modules/console/control/MissionsMenu.tsx`
- Create: `app/src/modules/console/control/useLaunchPreset.ts`
- Test: `app/src/modules/console/control/presets.test.ts`
- Modify: `app/src/modules/console/chrome/TopMenus.tsx`
- Source refs: `control.js:739-770` (PRESET_NEAR + control.launchPreset), `:774-847` (buildMissionsMenu / open / close / wire), `console.css:432-449` (.missions-menu/.mm-*).

**Interfaces:**
- Produces:
  - `presets.ts`: `PRESET_NEAR: Partial<Record<MissionType, LonLat>>` (the seven entries verbatim, comments included) and `PRESET_ORDER: MissionType[]` = `['security','infra','emergency','delivery','construction','highway','parks']`, plus `presetTypes(config): MissionType[]` implementing `control.js:777-778`'s ordered-then-remainder rule.
  - `useLaunchPreset()`: returns `launchPreset(type): Mission | null`, transcribing `control.js:752-770` — refuse unless `controlMode === 'normal'`, call `engine.launchPreset(type, near ? { near } : {})`, on throw push a `warn` ticker event `'MISSION LAUNCH FAILED · ' + msg` from source `'SENTINEL'` and return null, on success add to `userMissions`, set `followDroneId`, select the drone, and `map.flyTo({ center: dock.coords, zoom: 12.2 })`.
  - `MissionsMenu.tsx`: reuses Phase 1D's `<TopMenu name="missions" buttonId="btn-missions" extraClass="" align="right">` (add `'missions'` to the store's `TopMenuName` union) and renders `<div class="mm-head lbl">Launch predefined mission</div>` plus one `.mm-item` per preset type with `.mm-label` (config label) and `.mm-pat lbl` (config pattern). Clicking closes the menu and launches. Mounted from `TopMenus.tsx`.

- [ ] **Step 1: Write `presets.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import { PRESET_NEAR, PRESET_ORDER, presetTypes } from './presets'

describe('mission presets', () => {
  it('covers every configured mission type in the legacy order', () => {
    expect(presetTypes(MISSIONS_CONFIG)).toEqual(PRESET_ORDER)
  })
  it('each preset has a UAE-bounded geographic bias', () => {
    for (const type of PRESET_ORDER) {
      const near = PRESET_NEAR[type]
      expect(near).toBeTruthy()
      expect(near![0]).toBeGreaterThan(51)
      expect(near![0]).toBeLessThan(57)
      expect(near![1]).toBeGreaterThan(22)
      expect(near![1]).toBeLessThan(27)
    }
  })
  it('appends any config type missing from the fixed order', () => {
    const cfg = { ...MISSIONS_CONFIG, extra: MISSIONS_CONFIG.security } as typeof MISSIONS_CONFIG
    expect(presetTypes(cfg)).toEqual([...PRESET_ORDER, 'extra'])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement to green, then build the menu + hook**

- [ ] **Step 3: Verify + commit**

```bash
git add app/src/modules/console/control/ app/src/modules/console/chrome/
git commit -m "feat: predefined MISSIONS dropdown (Phase 1E)"
```

---

### Task 5: Debrief panel, session missions, and the debrief watch

**Files:**
- Create: `app/src/modules/console/panels/debriefModel.ts`
- Create: `app/src/modules/console/panels/RouteSvg.tsx`
- Create: `app/src/modules/console/panels/DebriefVideo.tsx`
- Create: `app/src/modules/console/panels/DebriefPanel.tsx`
- Create: `app/src/modules/console/panels/useDebriefWatch.ts`
- Test: `app/src/modules/console/panels/debriefModel.test.ts`
- Modify: `app/src/modules/console/panels/RightPanel.tsx`, `panels.css`
- Modify: `app/src/modules/console/chrome/RequestBoard.tsx` (the DELIVERED row now opens the debrief)
- Source refs: `panels.js:644-690` (ANALYTICS_FORMATS / humanizeKey / formatAnalyticsValue / analyticsDL), `:692-724` (debriefVideoSources / debriefVideoHTML), `:726-777` (routeSvg), `:779-813` (renderDebriefPanel), `:815-872` (missionReportHTML / exportMissionReport), `:874-943` (stopDebriefAnim / drawDebriefFrame / startDebriefPlaceholder), `:945-991` (wireDebriefPanel), `:993-1008` (timeHHMM / analyticsSummaryLine), `:1085-1097` (openDebrief), `:1099-1122` (recordCompletedMission + SESSION_MISSIONS_CAP 40), `:1124-1144` (wireDebriefWatch), `console.css:352-366` (.rp-analytics/.debrief-video/.debrief-canvas-wrap/.debrief-video-foot) and `:494-496` (.debrief-route).

**Interfaces:**
- Produces:
  - `debriefModel.ts` (pure): `ANALYTICS_FORMATS`, `humanizeKey(key)`, `formatAnalyticsValue(key, v)`, `analyticsEntries(mission): Array<{ label: string; value: string }>`, `debriefVideoSources(mission): string[]` (`${import.meta.env.BASE_URL}videos/<file>`), `routeGeometry(waypoints, w, h): { path: string; points: Array<{x,y}>; marks: Array<{x,y}> }` (the pure half of `routeSvg`, `panels.js:726-777`, so the SVG itself is JSX in `RouteSvg.tsx`), `analyticsSummaryLine(mission)`, `timeHHMM(date)`, `SESSION_MISSIONS_CAP = 40`, `missionReportText(mission): string` (the export payload from `:815-872` — keep whatever format legacy produced; read it and match).
  - `RouteSvg.tsx`: renders `panels.js:768-776`'s `<svg class="route-svg">` from `routeGeometry`, returning `null` for fewer than 2 waypoints.
  - `DebriefVideo.tsx`: the `.debrief-video` frame — a `<video>` over the mission's clips with the same chain-on-`ended`/`error` behavior `FpvFrame.tsx` already implements (reuse that pattern, do not duplicate the logic if it can be factored), falling back to the animated canvas placeholder (`drawDebriefFrame`, `panels.js:882-943`, ~30fps rAF, cancelled on unmount) when no clip loads. This is the "PENDING GENERATION" placeholder the project's open Higgsfield item refers to.
  - `DebriefPanel.tsx`: `panels.js:779-813` as JSX plus the EXPORT REPORT action (`:947-953` + `exportMissionReport`).
  - `useDebriefWatch()`: `panels.js:1124-1144` — subscribes to engine events, and on a mission completing calls `recordCompletedMission`: stamp `_debriefAt`, unshift into the store's `sessionMissions` (capped at 40), push a ticker event `'DEBRIEF READY · ' + mission.id` whose click opens the debrief, and auto-open the debrief only when the mission id is in `userMissions`. Unsubscribe via `offEvent`. Mounted once from `EngineProvider` or `Console.tsx` — pick the one that keeps it alive off-route the same way the ticker push is, and say which.

- [ ] **Step 1: Write `debriefModel.test.ts`** covering: `formatAnalyticsValue` for each key in `ANALYTICS_FORMATS` plus the camelCase fallback; `humanizeKey('timeToSceneS') === 'TIME TO SCENE'`; `analyticsEntries` on a completed engine mission; `debriefVideoSources` prefixing `BASE_URL`; `routeGeometry` returning a path with the right point count and staying inside the given box; `analyticsSummaryLine` on a mission with no analytics returning `'NO ANALYTICS'`.
- [ ] **Step 2: Run it, confirm it fails, implement `debriefModel.ts` to green**
- [ ] **Step 3: Implement `RouteSvg.tsx`, `DebriefVideo.tsx`, `DebriefPanel.tsx`, `useDebriefWatch.ts`, the CSS, the `RightPanel` `debrief` mode, and the RequestBoard DELIVERED row**
- [ ] **Step 4: Verify + commit**

```bash
git add app/src/modules/console/panels/ app/src/modules/console/chrome/
git commit -m "feat: mission debrief panel and session mission recording (Phase 1E)"
```

---

### Task 6: MEDIA library

**Files:**
- Create: `app/src/modules/console/panels/mediaModel.ts`
- Create: `app/src/modules/console/panels/MediaPanel.tsx`
- Test: `app/src/modules/console/panels/mediaModel.test.ts`
- Modify: `app/src/modules/console/panels/RightPanel.tsx`, `panels.css`, `app/src/modules/console/chrome/Topbar.tsx`
- Source refs: `panels.js:1010-1055` (mediaPosterHTML / renderMediaPanel), `:1057-1083` (wireMediaPanel — card click opens the debrief, filter chips), `console.css:368-383` (.media-grid/.media-card/...) and `:498-501` (.media-filters/.media-card-poster).

**Interfaces:**
- Produces: `mediaModel.ts` with `mediaPosterSrc(type)` and `mediaFilterTypes(sessionMissions): MissionType[]` (the `typesPresent` list from `panels.js:1024-1025`); `MediaPanel.tsx` rendering the empty state, the type filter chips and the `.media-card` grid from the store's `sessionMissions`, each card opening that mission's debrief. `Topbar.tsx`'s `#btn-media` stops being disabled: it exits any capture mode, clears the selection and opens the `media` right-panel mode (`panels.js:2520-2527`).

- [ ] **Step 1: Write `mediaModel.test.ts`** (poster path prefixing, `mediaFilterTypes` deduping in first-seen order, empty input -> empty list)
- [ ] **Step 2: Run it, confirm it fails, implement to green**
- [ ] **Step 3: Implement `MediaPanel.tsx`, the CSS, the `RightPanel` mode and the MEDIA button**
- [ ] **Step 4: Verify + commit**

```bash
git add app/src/modules/console/panels/ app/src/modules/console/chrome/
git commit -m "feat: MEDIA mission library (Phase 1E)"
```

---

### Task 7: Flight-request review panel and detection-track review panel

**Files:**
- Create: `app/src/modules/console/panels/RequestPanel.tsx`
- Create: `app/src/modules/console/panels/trackModel.ts`
- Create: `app/src/modules/console/panels/TrackPanel.tsx`
- Create: `app/src/modules/console/selection/useMapTrackInteractions.ts`
- Test: `app/src/modules/console/panels/trackModel.test.ts`
- Modify: `app/src/modules/console/panels/RightPanel.tsx`, `panels.css`, `app/src/modules/console/chrome/RequestBoard.tsx`, `app/src/modules/console/panels/OpsDigestPanel.tsx`
- Source refs: `panels.js:1376-1438` (renderRequestPanel / refreshViewedRequest), `:1444-1459` (wireRequestWatch), `:1745-1780` (APPROVE & LAUNCH / DECLINE handlers), `:1468-1512` (TRACK_STATUS_CHIP / getTrack / activeTrackCount / trackAgeStr / trackExpiryS / focusTrack), `:1517-1564` (renderTrackPanel), `:1566-1612` (refreshViewedTrack / wireTrackWatch), `:1614-1632` (wireMapTrackInteractions), `:1784-1822` (TASK A DRONE / DISMISS / VIEW handlers), `console.css:585-589` (request chips) and `:591-617` (track chips, `.trk-*`, `button.dg-det-track`).

**Interfaces:**
- Produces:
  - `RequestPanel.tsx`: `panels.js:1381-1423` as JSX, reading the request live off the engine by id (never a snapshot), showing the planned-route `<RouteSvg/>`, and rendering APPROVE & LAUNCH / DECLINE only while `status === 'pending'` (a read-only status chip otherwise). APPROVE transcribes `:1745-1767` (`engine.approveRequest`, failure ticker advisory, add to `userMissions`, select the launched drone); DECLINE transcribes `:1769-1776`. Legacy's `refreshViewedRequest` marker-element trick is unnecessary in React — re-render off the same 2s poll + `REQUEST_*` event subscription `RequestBoard` already uses, and note that in a comment.
  - `trackModel.ts` (pure): `TRACK_STATUS_CHIP`, `activeTrackCount(engine)`, `trackAgeStr(engine, track)`, `trackExpiryS(engine, track)` and the `< 60s` amber threshold from `console.css:599`.
  - `TrackPanel.tsx`: `panels.js:1517-1564` as JSX with the live age/expiry refresh on the same 2s cadence, plus TASK A DRONE (`engine.taskTrack`), DISMISS (`engine.dismissTrack`) and VIEW handlers from `:1784-1822`.
  - `useMapTrackInteractions()`: the `tracks-icons` click handler from `:1614-1632`, gated on `useMap().ready` and `inCaptureMode()`, opening the track panel and flying to it (`focusTrack`, `:1505-1512`).
  - `RequestBoard.tsx`'s pending-row click and `OpsDigestPanel.tsx`'s detection-track row both stop being seams and open the respective panels.

- [ ] **Step 1: Write `trackModel.test.ts`** (chip mapping per status, `activeTrackCount` counting only `active`, `trackAgeStr` / `trackExpiryS` against a booted engine's tracks)
- [ ] **Step 2: Run it, confirm it fails, implement `trackModel.ts` to green**
- [ ] **Step 3: Implement both panels, the map interaction hook, the CSS, the `RightPanel` modes and the two seam call sites**
- [ ] **Step 4: Verify + commit**

```bash
git add app/src/modules/console/
git commit -m "feat: flight-request and detection-track review panels (Phase 1E)"
```

---

### Task 8: Integration, capture-mode map click routing, and full browser verification

**Files:**
- Modify: `app/src/modules/console/Console.tsx`
- Create: `app/src/modules/console/control/useCaptureMapClicks.ts`
- Modify: `app/src/modules/console/selection/useMapSelection.ts`
- Modify: `app/src/modules/console/Console.test.tsx`
- Source refs: `control.js:685-701` (wireMapClicks), `:849-855` (initControl), `panels.js:2617-2630` (globe-scene teardown of capture modes).

**Interfaces:**
- `useCaptureMapClicks()`: a single `map.on('click', ...)` handler routing by `controlMode` — `'wizard'` -> `applyWizardClick`, `'manual'` -> `engine.manualQueue` on shift-click else `engine.manualGoto`, `'normal'` -> nothing (the layer-specific handlers in `useMapSelection` already bail via `inCaptureMode()`). Removed on cleanup.
- `Console.tsx` mounts `<ManualBanner/>`, `<MissionsMenu/>` (via `TopMenus`), and calls `useManualControl`, `useWizard`, `useCaptureMapClicks`, `useCaptureKeys`, `useMapTrackInteractions`, `useDebriefWatch`, and `registerCaptureExits`. The scene-leave effect additionally exits manual control and the wizard (`panels.js:2624-2625`).

- [ ] **Step 1: Implement the click routing + Console wiring**
- [ ] **Step 2: Extend `Console.test.tsx`** to assert the manual banner is absent in `normal` mode and present when the store says `manual`.
- [ ] **Step 3: Full local verification**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green. From the repo root: `node --test tests/*.test.js` -> 65/65.

- [ ] **Step 4: Browser verification with the Playwright MCP**

`npm run dev` from `app/`, then drive `http://localhost:5173/console` and prove, with DOM assertions and screenshots:
1. ENTER THEATER, wait ~20s: chrome + live sim as in Phase 1D.
2. `+ NEW MISSION` opens wizard step 1; pick a type tile; NEXT; two map clicks inside the dock ring add numbered waypoints and the `wizard-preview` source gains features; NEXT; LAUNCH creates a mission and selects the new drone.
3. Select a flying drone, click TAKE CONTROL: `#manual-banner` appears, the button reads RELEASE, `#rp-alt-row` is visible, a map click issues a manual goto, ESC releases and the banner disappears.
4. `MISSIONS` dropdown lists 7 presets; launching one selects a drone and flies the camera.
5. A pending flight-request row opens the review panel with APPROVE & LAUNCH / DECLINE.
6. Wait for a mission to complete (or launch a short one) and confirm the DEBRIEF READY ticker chip opens the debrief panel with a route snapshot and analytics; `MEDIA` lists it.
7. `read_console_messages` shows no errors throughout.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/console/
git commit -m "feat: capture-mode map click routing and Phase 1E integration"
```

---

## Self-Review

**Spec coverage (every Phase 1E seam left by Phase 1D):**
- `inCaptureMode()` returning a real value -> Task 1
- `#rp-launch` -> enterWizard -> Task 3
- `#rp-control` / `#rp-alt-row` -> enterManual / nudgeAlt -> Task 2
- `#btn-newmission` -> Task 1 (state) + Task 3 (action)
- `#btn-missions` -> Task 4
- `#btn-media` -> Task 6
- RequestBoard pending row -> request review panel -> Task 7
- RequestBoard delivered row -> debrief -> Task 5
- OpsDigest detection row -> track panel -> Task 7
- `updater.setRangeHighlight` exposure (Phase 1C deferral) -> Task 1
- ESC key / capture-mode map click routing -> Tasks 1 and 8

**Placeholder scan:** No TBD/TODO. Every task cites exact legacy line ranges; every test file's contract is spelled out and the four largest have their source given in full.

**Type consistency:** `WizardState` is defined once (Task 3's `wizardModel.ts`, or `store.ts` if the cycle forces it — the task says to pick and document) and consumed by Tasks 1, 3 and 8. `RightPanelState`'s widened union is defined in Task 1 and switched on in Tasks 3, 5, 6, 7. `isCaptureMode(mode)` (Task 1) backs `inCaptureMode()` (already called throughout Phase 1D). `enterManual`/`exitManual` (Task 2) and `enterWizard`/`exitWizard`/`launch` (Task 3) are registered through Task 1's `registerCaptureExits` and consumed by Tasks 2, 3, 7 and 8. `debriefVideoSources` (Task 5) and `fpvSources` (Phase 1D) both build `${import.meta.env.BASE_URL}videos/<file>`.
