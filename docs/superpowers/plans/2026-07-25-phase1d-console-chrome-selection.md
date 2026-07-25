# Phase 1D: Console Chrome + Entity Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal placeholder chrome in `app/src/modules/console/Console.tsx` with the real console shell — topbar (brand, live chips, DOCKS/FILTER/LAYERS dropdowns, OPS/MISSIONS/NEW MISSION/MEDIA/GLOBE buttons, clock), left sidebar (live-network tile, national-grid stats, FLIGHT REQUESTS board), right panel with its ops-digest/dock/drone/site modes, collapsible panel toggles, scene chrome fade — and the `EC2.select` selection state machine that binds map clicks, dock rows, ticker chips and panel actions to the store's `selection`/`followDroneId` slices that Phase 1C already reads every frame.

**Architecture:** Legacy `panels.js` is one 2751-line IIFE that owns module-level mutable state (`currentFilter`, `dockSearch`, `dockSort`, `dockListSig`, `droneTeleTimer`, `digestTimer`, `EC2.followDroneId`) and paints via `innerHTML` + `getElementById`. The React port splits it by responsibility into `app/src/modules/console/chrome/` (topbar, sidebar, panel toggles, scene fade, top menus, dock list) and `app/src/modules/console/panels/` (right-panel modes), with the imperative-signature/dirty-check optimizations replaced by React's own reconciliation. All cross-cutting mutable state moves onto the Zustand store; the `EC2.select` state machine becomes a pure-ish `selectEntity()` action module that reads the engine + map and writes the store. Per-frame map updates stay imperative (Phase 1C invariant, unchanged); panel refreshes run on the same low-frequency timers legacy used (2 Hz drone telemetry, 1 Hz digest, 1 s clock, 1 s follow driver, 2 s dock/request poll).

**Tech Stack:** React 18, TypeScript (strict), MapLibre GL v5, Zustand, the Phase 1A domain + Phase 1B map + Phase 1C engine binding, Vitest (+ jsdom via per-file `@vitest-environment jsdom` pragma).

## Global Constraints

- **Faithful 1:1 port.** Transcribe legacy logic, constants, thresholds, class names, element ids and UI copy from `assets/js/ui/panels.js`, `console.html` and `assets/css/console.css` exactly. Only module wiring, types, and DOM-painting mechanism (innerHTML -> JSX) may change. When in doubt, open the cited legacy lines and copy.
- **No `any`.** TypeScript strict; `npm run lint` runs with `--max-warnings 0`.
- **No em dashes in UI copy.** Mono micro-labels are 9.5px / `.22em` / uppercase (the `.lbl` class). Red `#ff5a5a` / `#BC0000` is reserved for brand + alerts.
- **HTML escaping is not needed** — JSX escapes text children by construction. Do NOT port `escapeHtml`; render values as JSX text nodes. (The one legacy affordance it preserved, a `<b>` subset in ticker copy, is not used by any engine event.)
- **Per-frame map updates stay imperative.** Nothing in this phase may push engine state into React at 60fps. Panel/HUD refresh rates are the legacy ones: drone telemetry 500ms, ops digest 1000ms, clock 1000ms, follow driver 1000ms, dock-list + request-board poll 2000ms.
- **Map readiness gates on MapView's one-way `ready` latch** from `useMap()`, NEVER `map.loaded()`.
- **`<EngineProvider>` stays above `<Routes>`** in `App.tsx`. Do not move it.
- **Legacy stays live.** Only `app/` is touched. Do not edit `assets/`, `console.html`, `index.html`, or `.github/workflows/deploy.yml`.
- **Deferred to Phase 1E, explicitly out of scope here:** manual control (`control.js`), the mission wizard, the debrief panel, the MEDIA library, the flight-request review panel, and the detection-track review panel. Where legacy calls into those (`EC2.control.*`, `openDebrief`, `setRightPanel('request'|'track'|'debrief'|'media'|'wizard')`), this phase lands the *seam* — a typed no-op/stub with a `// Phase 1E` comment — never a silent omission. `inCaptureMode()` ports as a function returning `false` (no capture modes exist yet) so every guard site is already in place.
- **npm on this Windows checkout:** the repo path contains `&`. Run npm from `app/` via Bash with `export npm_config_script_shell=bash`; before `git commit` also `export PATHEXT=";$PATHEXT"`. `app/.npmrc` (gitignored) already pins `script-shell` locally. The pre-commit hook does NOT typecheck — run `npm run typecheck` yourself before committing.
- **Test command:** `npm run test` from `app/` (Vitest). Legacy suite (`node --test tests/*.test.js` from repo root) must stay 65/65 — it should be untouched, but re-run it before the final commit of the phase.
- Import shared/domain/map/engine code via the `@/` alias.

---

## File Structure

New directories under `app/src/modules/console/`:

- `chrome/` — the console shell: `chrome.css`, `ConsoleChrome.tsx`, `Topbar.tsx`, `TopMenu.tsx`, `DocksMenu.tsx`, `FilterMenu.tsx`, `LayersMenu.tsx`, `dockList.ts`, `DockList.tsx`, `Sidebar.tsx`, `LiveNetworkTile.tsx`, `RequestBoard.tsx`, `requestBoard.ts`, `PanelToggle.tsx`, `Clock.tsx`, `useChromeFade.ts`, `emirates.ts`, `format.ts`.
- `panels/` — the right panel: `RightPanel.tsx`, `OpsDigest.tsx`, `opsDigest.ts`, `DockPanel.tsx`, `SitePanel.tsx`, `DronePanel.tsx`, `dronePanel.ts`, `FpvFrame.tsx`, `panels.css`.
- `selection/` — the selection state machine: `selectEntity.ts`, `useMapSelection.ts`, `useFollowDriver.ts`.

Modified: `shared/store.ts`, `modules/console/Console.tsx`, `modules/console/hud/{GridStats,Ticker}.tsx` + `hud.css`, `modules/console/OfflineChip.tsx`, `modules/console/engine/useLiveLayers.ts`, `modules/console/engine/EngineProvider.tsx`, `modules/console/domain/engine.ts`.

---

### Task 1: Store slices, engine `offEvent`, and shared chrome formatting helpers

**Files:**
- Modify: `app/src/shared/store.ts`
- Modify: `app/src/modules/console/domain/engine.ts` (add `offEvent`)
- Modify: `app/src/modules/console/engine/useLiveLayers.ts` (use `offEvent`)
- Create: `app/src/modules/console/chrome/emirates.ts`
- Create: `app/src/modules/console/chrome/format.ts`
- Test: `app/src/modules/console/chrome/format.test.ts`
- Modify: `app/src/shared/store.test.ts`
- Source refs: `panels.js:2-5` (EMIRATE_NAMES), `panels.js:9,26-28` (currentFilter/dockSearch/dockSort), `panels.js:115-120` (FLYING_STATES/ALERT_STATES/nowClockStr), `panels.js:152-155` (fmtETA), `panels.js:632-641` (fmtMMSS/thousands), `panels.js:401-407` (battLevel/padHeading), `panels.js:1950` (FILTER_KEYS), `panels.js:2572-2585` (panel collapse body classes), `panels.js:48-52` (DRONE_STATE_LABELS).

**Interfaces:**
- Consumes: `@/modules/console/domain` types.
- Produces:
  - `store.ts` gains: `rightPanel: RightPanelState` where `type RightPanelState = { mode: 'empty' } | { mode: 'dock'; id: string } | { mode: 'drone'; id: string } | { mode: 'site'; id: string }` (Phase 1E widens this union — leave a comment saying so); `dockFilter: FilterKey` (default `'ALL'`); `dockSearch: string` (default `''`); `dockSort: DockSort` (default `'ID'`); `sideCollapsed: boolean` (false); `rpanelCollapsed: boolean` (false); `openMenu: TopMenuName | null` (null). Actions: `setRightPanel`, `setDockFilter`, `setDockSearch`, `setDockSort`, `toggleSideCollapsed`, `toggleRpanelCollapsed`, `setOpenMenu`. Exported types `RightPanelState`, `FilterKey`, `DockSort`, `TopMenuName`.
  - `engine.ts` gains `offEvent(cb): void` on the `Engine` interface + implementation (splices `_subscribers` by identity).
  - `emirates.ts`: `EMIRATE_NAMES: Record<string, string>`, `EMIRATE_ORDER: string[]`, `FILTER_KEYS: FilterKey[]`.
  - `format.ts`: `nowClockStr(): string`, `fmtETA(totalS: number): string`, `fmtMMSS(totalS: number): string`, `thousands(v: unknown): string`, `battLevel(pct: number): 'ok' | 'amber' | 'red'`, `padHeading(deg: number): string`, `FLYING_STATES: DockState[]`, `ALERT_STATES: DockState[]`, `DRONE_STATE_LABELS: Record<DroneState, string>`.

Note: `nowClockStr` already exists in `app/src/modules/console/hud/tickerModel.ts`. Move the canonical implementation into `chrome/format.ts` and re-export it from `tickerModel.ts` (`export { nowClockStr } from '@/modules/console/chrome/format'`) so there is exactly one copy and every existing import keeps working.

- [ ] **Step 1: Write the failing `format.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { fmtETA, fmtMMSS, thousands, battLevel, padHeading } from './format'

describe('chrome format helpers', () => {
  it('fmtETA renders M:SS with single-digit minutes allowed (panels.js:152-155)', () => {
    expect(fmtETA(0)).toBe('0:00')
    expect(fmtETA(65)).toBe('1:05')
    expect(fmtETA(-5)).toBe('0:00')
    expect(fmtETA(600)).toBe('10:00')
  })
  it('fmtMMSS zero-pads minutes (panels.js:632-637)', () => {
    expect(fmtMMSS(0)).toBe('00:00')
    expect(fmtMMSS(65)).toBe('01:05')
    expect(fmtMMSS(3599)).toBe('59:59')
  })
  it('thousands groups finite numbers and passes anything else through', () => {
    expect(thousands(1234567)).toBe('1,234,567')
    expect(thousands('n/a')).toBe('n/a')
  })
  it('battLevel thresholds match panels.js:401-403', () => {
    expect(battLevel(25)).toBe('red')
    expect(battLevel(26)).toBe('amber')
    expect(battLevel(49)).toBe('amber')
    expect(battLevel(50)).toBe('ok')
  })
  it('padHeading normalises and zero-pads to 3 digits (panels.js:405-407)', () => {
    expect(padHeading(7)).toBe('007')
    expect(padHeading(-90)).toBe('270')
    expect(padHeading(365)).toBe('005')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

From `app/`, with `export npm_config_script_shell=bash`:
`npm run test -- src/modules/console/chrome/format.test.ts`
Expected: FAIL, "Failed to resolve import ./format".

- [ ] **Step 3: Write `emirates.ts` and `format.ts`**

`emirates.ts`:

```ts
// Ported from assets/js/ui/panels.js:2-5 (EMIRATE_NAMES), :2064
// (EMIRATE_ORDER) and :1950 (FILTER_KEYS).
import type { FilterKey } from '@/shared/store'

export const EMIRATE_NAMES: Record<string, string> = {
  AUH: 'Abu Dhabi',
  DXB: 'Dubai',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
  AAN: 'Al Ain',
}

export const EMIRATE_ORDER = Object.keys(EMIRATE_NAMES)

export const FILTER_KEYS: FilterKey[] = [
  'ALL', 'AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ', 'AAN', 'FLYING', 'ALERTS',
]
```

`format.ts` transcribes, in order: `nowClockStr` (panels.js:118-120 — `new Date().toLocaleTimeString('en-GB', { hour12: false })`), `FLYING_STATES`/`ALERT_STATES` (:115-116), `fmtETA` (:152-155), `fmtMMSS` (:632-637), `thousands` (:639-642), `battLevel` (:401-403), `padHeading` (:405-407), `DRONE_STATE_LABELS` (:48-52). Type `FLYING_STATES`/`ALERT_STATES` as `DockState[]` and `DRONE_STATE_LABELS` as `Record<DroneState, string>`, importing both from `@/modules/console/domain`.

- [ ] **Step 4: Run the test to green**

`npm run test -- src/modules/console/chrome/format.test.ts` -> 5/5 pass.

- [ ] **Step 5: Add the store slices**

Extend `AppState` in `app/src/shared/store.ts` with the fields/actions in the Interfaces block above. Keep the existing slices untouched. Add doc comments citing the legacy module-level variables each slice replaces. `RightPanelState` replaces legacy's `setRightPanel(mode, data)` argument pair — the panel now stores an **id**, not an entity object, so every render reads live engine state (this is what legacy's `renderRequestPanel` already did deliberately, panels.js:1376-1380; applying it uniformly is the one intentional improvement in this task).

- [ ] **Step 6: Add `offEvent` to the domain engine**

In `app/src/modules/console/domain/engine.ts`, add to the `Engine` interface:

```ts
  offEvent(cb: (ev: SimEvent) => void): void
```

and to the created object, beside `onEvent`:

```ts
  // Counterpart to onEvent. Legacy never needed one (subscribers lived for
  // the page lifetime); React components mount and unmount, so subscribers
  // must be removable by identity rather than each caller splicing
  // `_subscribers` itself.
  offEvent(cb) {
    const i = this._subscribers.indexOf(cb)
    if (i !== -1) this._subscribers.splice(i, 1)
  },
```

Match the surrounding object's `this`/closure style exactly — read `onEvent`'s implementation first and mirror it. Then update `attachEngineEvents` in `app/src/modules/console/engine/useLiveLayers.ts` to `return () => engine.offEvent(cb)` instead of splicing `_subscribers` directly, and delete the now-stale comment about the missing unsubscribe.

- [ ] **Step 7: Extend `store.test.ts`**

Add a test asserting the new defaults and that each new setter updates only its own field:

```ts
it('exposes Phase 1D chrome defaults', () => {
  const s = useAppStore.getState()
  expect(s.rightPanel).toEqual({ mode: 'empty' })
  expect(s.dockFilter).toBe('ALL')
  expect(s.dockSearch).toBe('')
  expect(s.dockSort).toBe('ID')
  expect(s.sideCollapsed).toBe(false)
  expect(s.rpanelCollapsed).toBe(false)
  expect(s.openMenu).toBe(null)
})

it('toggles panel collapse independently', () => {
  useAppStore.getState().toggleSideCollapsed()
  expect(useAppStore.getState().sideCollapsed).toBe(true)
  expect(useAppStore.getState().rpanelCollapsed).toBe(false)
  useAppStore.getState().toggleSideCollapsed()
  expect(useAppStore.getState().sideCollapsed).toBe(false)
})
```

Follow the existing file's reset-between-tests convention (read it first; if it has none, use `useAppStore.setState(...)` in a `beforeEach` to restore defaults so the suite stays order-independent).

- [ ] **Step 8: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — all green.

```bash
git add app/src/shared/store.ts app/src/shared/store.test.ts app/src/modules/console/chrome/ app/src/modules/console/domain/engine.ts app/src/modules/console/engine/useLiveLayers.ts app/src/modules/console/hud/tickerModel.ts
git commit -m "feat: chrome store slices, engine offEvent, shared format helpers (Phase 1D)"
```

---

### Task 2: Chrome CSS + `ConsoleChrome` shell + scene fade + panel collapse toggles

**Files:**
- Create: `app/src/modules/console/chrome/chrome.css`
- Create: `app/src/modules/console/chrome/useChromeFade.ts`
- Create: `app/src/modules/console/chrome/PanelToggle.tsx`
- Create: `app/src/modules/console/chrome/ConsoleChrome.tsx`
- Modify: `app/src/shared/tokens.css`
- Test: `app/src/modules/console/chrome/useChromeFade.test.tsx`
- Source refs: `console.css:7-20` (--chrome/--chrome-blur + data-maplayer overrides), `console.css:64-155` (chrome-in, #topbar, .t-brand, #clock, .tbtn, #side, #rpanel, #rpanel-body, collapse transitions, .panel-toggle, bright-basemap panel backing), `console.css:154-196` (.panel, .live-net, .stats, .filters, #docklist, .empty-note), `console.css:197-296` (right-panel content + telemetry + FPV), `console.css:385-413` (#ticker + .tick-ev incl. is-active/is-past/clickable), `console.css:432-449` (.missions-menu/.mm-*), `console.css:473-519` (ops digest, dock tools), `console.css:536-654` (topbar responsive, flight requests, request board, top-menu variants), `console.html:24-80` (DOM skeleton), `panels.js:2572-2585` (wirePanelToggles), `panels.js:2587-2631` (wireScene).

**Interfaces:**
- Consumes: `@/shared/store` (`scene`, `sideCollapsed`, `rpanelCollapsed`).
- Produces:
  - `chrome.css`: the full transcription of the console chrome styles listed above. Legacy keyed panel collapse off `body.side-collapsed` / `body.rpanel-collapsed`; keep those exact class names and have `ConsoleChrome` add/remove them on `document.body` in an effect (with cleanup), so every transcribed selector works unchanged.
  - `useChromeFade(scene: Scene): { hidden: boolean; opacity: 0 | 1 }` — the port of `wireScene`'s `setVisible`: on show, un-hide immediately then flip opacity to 1 on the next frame (double rAF + 120ms fallback timeout); on hide, flip opacity to 0 immediately and set `hidden` after 220ms; a show cancels any pending hide timer. Cleans up timers/rAF on unmount.
  - `PanelToggle.tsx`: props `{ side: 'left' | 'right' }`. Renders `<button id="side-toggle"|"rpanel-toggle" class="panel-toggle chrome-in" aria-expanded title aria-label><i/></button>` per `console.html:78-79`, toggling the matching store flag. `aria-expanded`/`title`/`aria-label` track collapse exactly as `panels.js:2577-2583` ("Collapse panel"/"Expand panel", `aria-label` = `${verb} ${side} panel`).
  - `ConsoleChrome.tsx`: props `{ topbar, sidebar, rightPanel, ticker }: Record<string, ReactNode>`. Renders `<header id="topbar">`, `<aside id="side">`, `<aside id="rpanel"><div id="rpanel-body">`, the two `<PanelToggle>`s and the ticker slot, all carrying `className="chrome-in"` and the `hidden`/`style.opacity` from `useChromeFade`, mirroring `console.html:24-80`'s element ids/nesting. Adds/removes the body collapse classes.

- [ ] **Step 1: Add the chrome tokens**

Append to `app/src/shared/tokens.css`, transcribing `console.css:7-20` including its explanatory comment:

```css
  --chrome: rgba(10, 11, 14, 0.82);
  --chrome-blur: blur(10px);
}
:root[data-maplayer='light'],
:root[data-maplayer='sat'],
:root[data-maplayer='terrain'] {
  --chrome: rgba(10, 11, 14, 0.7);
  --chrome-blur: blur(18px);
}
```

(The first two lines go inside the existing `:root {}` block; the `[data-maplayer]` rule follows it.) Then update `app/src/modules/console/hud/hud.css` to use `var(--chrome)` / `var(--chrome-blur)` in `#ticker` instead of its hardcoded `rgba(10,11,14,.82)`/`blur(10px)`, and delete the comment there saying the tokens are not ported yet.

- [ ] **Step 2: Write `chrome.css`**

Transcribe the listed `console.css` rules verbatim (values, not just intent). Two deliberate deviations, each needing an inline comment:
1. Rules whose legacy home was `console.css` but whose subject now lives in another app module are NOT duplicated here: `.tick-ev*` and `#ticker` stay in `hud.css` (Task 7 moves `#ticker` back to its real `left:318px;right:340px` inset there), `#basemap-loading` stays in `map.css`, `#globe-*` stays in `globe.css`. Everything else in the cited ranges belongs here.
2. `.rp-*`, `.tele-*`, `.fpv-*`, `.digest-*`, `.dg-*`, `.state-chip`, `.batt-bar` go in `panels/panels.css` (Task 6/7), not here. `chrome.css` covers the shell + sidebar + top menus + dock list + request board only.

Vite bundles CSS per import — import `chrome.css` from `ConsoleChrome.tsx`.

- [ ] **Step 3: Write the failing `useChromeFade.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChromeFade } from './useChromeFade'

describe('useChromeFade', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(0), 16) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is visible immediately on the console scene', () => {
    const { result } = renderHook(() => useChromeFade('console'))
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.hidden).toBe(false)
    expect(result.current.opacity).toBe(1)
  })

  it('starts hidden on the globe scene', () => {
    const { result } = renderHook(() => useChromeFade('globe'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.hidden).toBe(true)
  })

  it('fades out over 220ms, staying mounted until the timer lands', () => {
    const { result, rerender } = renderHook(({ s }) => useChromeFade(s), {
      initialProps: { s: 'console' as const },
    })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ s: 'globe' as const })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.opacity).toBe(0)
    expect(result.current.hidden).toBe(false)
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.hidden).toBe(true)
  })

  it('a show cancels a pending hide (panels.js:2596-2599)', () => {
    const { result, rerender } = renderHook(({ s }) => useChromeFade(s), {
      initialProps: { s: 'console' as const },
    })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ s: 'globe' as const })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ s: 'console' as const })
    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current.hidden).toBe(false)
    expect(result.current.opacity).toBe(1)
  })
})
```

- [ ] **Step 4: Run it, confirm it fails, then implement `useChromeFade.ts` to green**

`npm run test -- src/modules/console/chrome/useChromeFade.test.tsx` — FAIL first (module missing), then 4/4 after implementing. The hide timeout is 220ms and the reveal fallback timeout is 120ms, exactly as `panels.js:2604-2612`.

- [ ] **Step 5: Write `PanelToggle.tsx` and `ConsoleChrome.tsx`**

Per the Interfaces block. `ConsoleChrome` must NOT render any panel content itself — it takes them as props so Tasks 3-7 can be developed and reviewed independently.

- [ ] **Step 6: Wire a temporary integration into `Console.tsx` and verify in the browser**

Render `<ConsoleChrome topbar={null} sidebar={null} rightPanel={null} ticker={<Ticker/>} />` in place of the placeholder layer buttons for the console scene, keeping `<GridStats/>` where it is for now (Task 5 moves it into the sidebar). Run `npm run dev`, open `/console`, dive into the theater, and confirm via `read_console_messages` (no errors) and `read_page` that `#topbar`, `#side`, `#rpanel`, `#side-toggle`, `#rpanel-toggle` exist and are not `hidden` in the console scene, and that clicking `#side-toggle` puts `side-collapsed` on `<body>`. Stop the server.

- [ ] **Step 7: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green.

```bash
git add app/src/modules/console/chrome/ app/src/shared/tokens.css app/src/modules/console/hud/hud.css app/src/modules/console/Console.tsx
git commit -m "feat: console chrome shell, scene fade, collapsible panels (Phase 1D)"
```

---

### Task 3: Selection state machine, follow driver, and map click interactions

**Files:**
- Create: `app/src/modules/console/selection/selectEntity.ts`
- Create: `app/src/modules/console/selection/useMapSelection.ts`
- Create: `app/src/modules/console/selection/useFollowDriver.ts`
- Test: `app/src/modules/console/selection/selectEntity.test.ts`
- Source refs: `panels.js:2455-2493` (EC2.select), `panels.js:2440-2449` (startFollowDriver), `panels.js:2405-2437` (setRightPanel's FOLLOW-clearing rule at :2417-2421), `panels.js:2636-2699` (inCaptureMode + wireMapDockInteractions), `panels.js:2143-2160` (selectedDockId).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`Engine`, `DATA_DOCKS`, `DATA_SITES`), `@/shared/store`, `@/modules/console/map/MapContext`.
- Produces:
  - `selectEntity.ts`:
    - `inCaptureMode(): boolean` — returns `false`. Phase 1E replaces the body; every call site is already correct.
    - `DOCK_INDEX: Map<string, DockSeed>` and `SITE_INDEX: Map<string, Site>` — module-level indexes built once from `DATA_DOCKS`/`DATA_SITES` (legacy `buildDockIndex`/`buildSiteIndex`, panels.js:75-83). These are static data, so module scope is correct and matches legacy.
    - `selectEntity(sel: Selection, engine: Engine | null, map: maplibregl.Map | null): void` — the port of `EC2.select`. Dock: look up in `DOCK_INDEX`, bail if missing; compute `changed` against the store's current selection; set `selection` + `rightPanel = { mode: 'dock', id }`; `map.flyTo({ center: dock.coords, zoom: 11 })` **only when changed**. Drone: bail without an engine or without `engine.drones.get(id)`; set `selection` + `rightPanel = { mode: 'drone', id }`; NO camera move (FOLLOW owns the camera — transcribe legacy's comment). Site: look up in `SITE_INDEX`, bail if missing; set `selection` + `rightPanel = { mode: 'site', id }`. Every branch goes through `applyPanel()` below.
    - `applyPanel(next: RightPanelState): void` — the store-side half of `setRightPanel`'s contract at panels.js:2417-2421: FOLLOW survives only a re-selection of the exact same drone; any other panel change clears `followDroneId`. (The interval-clearing half is now each panel component's own effect cleanup, so it has no analogue here — say so in a comment.)
    - `clearSelection(): void` — OPS button / globe-scene exit: `selection = null`, `followDroneId = null`, `rightPanel = { mode: 'empty' }` (panels.js:2504-2512, :2622-2629).
    - `selectedDockId(selection: Selection | null): string | null` — panels.js:2145-2151, including the `D-` prefix strip for drone selections.
  - `useMapSelection(): void` — a hook called inside the map subtree. Registers the click/mouseenter/mouseleave handlers for `docks-dots`, `drones-layer`, `sites-dots` and the `coverage-fill` forgiving-click fallback (panels.js:2640-2699) on the ready map, all guarded by `inCaptureMode()`, and removes every handler on cleanup (`map.off(type, layerId, handler)`).
  - `useFollowDriver(): void` — the 1 Hz camera driver (panels.js:2442-2449): while `followDroneId` is set and the drone exists and is not `'docked'`, `map.easeTo({ center: drone.pos, zoom: 12.5, duration: 950 })`; a landed/missing drone clears `followDroneId`. `setInterval` in an effect, cleared on unmount.

- [ ] **Step 1: Write the failing `selectEntity.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SimEngine, DATA_DOCKS, DATA_SITES, GEO_UAE } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { selectEntity, clearSelection, selectedDockId, inCaptureMode } from './selectEntity'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5)
  return e
}

function fakeMap() {
  return { flyTo: vi.fn(), easeTo: vi.fn() } as unknown as import('maplibre-gl').Map
}

describe('selectEntity', () => {
  beforeEach(() => {
    useAppStore.setState({
      selection: null,
      followDroneId: null,
      rightPanel: { mode: 'empty' },
    })
  })

  it('inCaptureMode is false until Phase 1E lands manual/wizard modes', () => {
    expect(inCaptureMode()).toBe(false)
  })

  it('selecting a dock sets selection + panel and flies the camera once', () => {
    const map = fakeMap()
    const id = DATA_DOCKS[0].id
    selectEntity({ type: 'dock', id }, null, map)
    expect(useAppStore.getState().selection).toEqual({ type: 'dock', id })
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'dock', id })
    expect(map.flyTo).toHaveBeenCalledTimes(1)
    selectEntity({ type: 'dock', id }, null, map)
    expect(map.flyTo).toHaveBeenCalledTimes(1) // unchanged selection does not re-fly
  })

  it('ignores an unknown dock id', () => {
    const map = fakeMap()
    selectEntity({ type: 'dock', id: 'NOPE-999' }, null, map)
    expect(useAppStore.getState().selection).toBe(null)
    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('selecting a live drone sets the panel and never moves the camera', () => {
    const engine = bootedEngine()
    const map = fakeMap()
    const drone = [...engine.drones.values()].find((d) => d.state !== 'docked')
    expect(drone).toBeTruthy()
    selectEntity({ type: 'drone', id: drone!.id }, engine, map)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'drone', id: drone!.id })
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('a drone selection needs an engine', () => {
    selectEntity({ type: 'drone', id: 'D-AUH-01' }, null, fakeMap())
    expect(useAppStore.getState().selection).toBe(null)
  })

  it('selecting a site sets the site panel', () => {
    const id = DATA_SITES[0].id
    selectEntity({ type: 'site', id }, null, fakeMap())
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'site', id })
  })

  it('FOLLOW survives re-selecting the same drone but not a different entity', () => {
    const engine = bootedEngine()
    const drone = [...engine.drones.values()].find((d) => d.state !== 'docked')!
    useAppStore.setState({ followDroneId: drone.id })
    selectEntity({ type: 'drone', id: drone.id }, engine, fakeMap())
    expect(useAppStore.getState().followDroneId).toBe(drone.id)
    selectEntity({ type: 'dock', id: DATA_DOCKS[0].id }, engine, fakeMap())
    expect(useAppStore.getState().followDroneId).toBe(null)
  })

  it('clearSelection resets selection, follow and the panel', () => {
    useAppStore.setState({
      selection: { type: 'dock', id: DATA_DOCKS[0].id },
      followDroneId: 'D-X',
      rightPanel: { mode: 'dock', id: DATA_DOCKS[0].id },
    })
    clearSelection()
    expect(useAppStore.getState().selection).toBe(null)
    expect(useAppStore.getState().followDroneId).toBe(null)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'empty' })
  })

  it('selectedDockId maps a drone selection back to its dock row', () => {
    expect(selectedDockId(null)).toBe(null)
    expect(selectedDockId({ type: 'dock', id: 'AUH-01' })).toBe('AUH-01')
    expect(selectedDockId({ type: 'drone', id: 'D-AUH-01' })).toBe('AUH-01')
    expect(selectedDockId({ type: 'site', id: 'S-01' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

`npm run test -- src/modules/console/selection/selectEntity.test.ts` -> FAIL (module not found).

- [ ] **Step 3: Implement `selectEntity.ts` to green**

Re-run: 9/9 pass.

- [ ] **Step 4: Write `useMapSelection.ts` and `useFollowDriver.ts`**

Both are effect hooks gated on `useMap().ready`. Read the Phase 1B/1C hooks (`usePingDriver.ts`, `useLiveLayers.ts`) first and match their structure and cleanup discipline. The `coverage-fill` handler transcribes panels.js:2679-2698 exactly, including `DOT_LAYERS`, the `queryRenderedFeatures` bail, and site-over-dock preference.

- [ ] **Step 5: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/selection/
git commit -m "feat: entity selection state machine, follow driver, map click wiring (Phase 1D)"
```

---

### Task 4: Topbar with live chips, clock, and action buttons

**Files:**
- Create: `app/src/modules/console/chrome/Topbar.tsx`
- Create: `app/src/modules/console/chrome/Clock.tsx`
- Modify: `app/src/modules/console/OfflineChip.tsx`
- Test: `app/src/modules/console/chrome/Topbar.test.tsx`
- Source refs: `console.html:24-43` (topbar DOM), `panels.js:2294-2309` (setStats's `#c-air`/`#c-alerts` chip branches), `panels.js:2497-2529` (wireTopbar), `panels.js:1967-1971` (FILTER label), `panels.js:1986-1991` (LAYERS label), `console.css:67-88` + `:536-553` (topbar styles + responsive drop-out).

**Interfaces:**
- Consumes: `@/shared/store` (`stats`, `offline`, `dockFilter`, `layer`, `openMenu`), `@/modules/console/chrome/format` (`nowClockStr`), `@/modules/console/selection` (`clearSelection`), `useGlobe`'s `exitToOrbit` (passed in as a prop, since `Topbar` renders outside the hook that owns it).
- Produces:
  - `Clock.tsx`: `#clock` with `nowClockStr()` + `<span>GST</span>`, repainting on a 1000ms interval (panels.js:2560-2566), cleaned up on unmount.
  - `Topbar.tsx`: props `{ onExitToOrbit: () => void }`. Renders `console.html:24-43` faithfully: `.t-brand` (logo `${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`, "SENTINEL" title + "GLOBAL COMMAND & CONTROL" label), `.chip.ok-chip` GRID ONLINE, `#btn-docks` chip-button showing the dock count (`DATA_DOCKS.length`), `#c-air` AIRBORNE chip, `#c-alerts` warn chip (hidden at 0), `#offline-chip`, `.sp` spacer, then `#btn-layers` / `#btn-filter` / `#btn-ops` / `#btn-missions` / `#btn-newmission` / `#btn-media` / `#btn-globe` and `<Clock/>`. The AIRBORNE/ALERTS numbers use `useCountUp` (the existing `hud/useCountUp.ts`) so they tween exactly like the sidebar tiles did under `tweenStat`. `#btn-layers` and `#btn-filter` labels are derived live (`LAYERS · DARK ▾`, `FILTER ▾` / `FILTER · DXB ▾`). `#btn-ops` calls `clearSelection()`. `#btn-globe` calls `onExitToOrbit`. `#btn-missions`, `#btn-newmission`, `#btn-media` are rendered with their legacy titles but `disabled` and a `// Phase 1E` comment naming what will enable each.
  - `OfflineChip.tsx` is rewritten to render the plain inline `<div className="chip warn" id="offline-chip" hidden={!offline}>OFFLINE MODE · VECTOR MAP</div>` for use *inside* the topbar (the fixed-pill styling and its inline `style` object are deleted; the `.chip.warn` rules in `chrome.css` now supply the look).

- [ ] **Step 1: Write the failing `Topbar.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import Topbar from './Topbar'
import { useAppStore } from '@/shared/store'

describe('Topbar', () => {
  beforeEach(() => {
    useAppStore.setState({
      stats: { ready: 90, flying: 7, charge: 5, alert: 0 },
      offline: false,
      dockFilter: 'ALL',
      layer: 'dark',
      selection: { type: 'dock', id: 'X' },
      rightPanel: { mode: 'dock', id: 'X' },
      followDroneId: 'D-X',
    })
  })

  it('renders the brand, the grid-online chip and the layer/filter labels', () => {
    render(<Topbar onExitToOrbit={() => {}} />)
    expect(screen.getByText('SENTINEL')).toBeTruthy()
    expect(screen.getByText('GRID ONLINE')).toBeTruthy()
    expect(screen.getByRole('button', { name: /LAYERS/ }).textContent).toContain('DARK')
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).not.toContain('·')
  })

  it('shows the active filter on the FILTER trigger', () => {
    useAppStore.setState({ dockFilter: 'DXB' })
    render(<Topbar onExitToOrbit={() => {}} />)
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).toContain('DXB')
  })

  it('hides the ALERTS chip at zero and shows it above zero', () => {
    const { rerender } = render(<Topbar onExitToOrbit={() => {}} />)
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(true)
    act(() => {
      useAppStore.setState({ stats: { ready: 90, flying: 7, charge: 5, alert: 3 } })
    })
    rerender(<Topbar onExitToOrbit={() => {}} />)
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(false)
  })

  it('OPS clears selection, follow and the right panel (panels.js:2504-2512)', () => {
    render(<Topbar onExitToOrbit={() => {}} />)
    act(() => { screen.getByRole('button', { name: 'OPS' }).click() })
    expect(useAppStore.getState().selection).toBe(null)
    expect(useAppStore.getState().followDroneId).toBe(null)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'empty' })
  })

  it('GLOBE calls the exit handler', () => {
    const exit = vi.fn()
    render(<Topbar onExitToOrbit={exit} />)
    act(() => { screen.getByRole('button', { name: 'GLOBE' }).click() })
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `Clock.tsx` + `Topbar.tsx` + the `OfflineChip` rewrite to green**

`npm run test -- src/modules/console/chrome/Topbar.test.tsx` -> FAIL, then 5/5.

- [ ] **Step 3: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/chrome/ app/src/modules/console/OfflineChip.tsx
git commit -m "feat: real topbar with live chips, clock and action buttons (Phase 1D)"
```

---

### Task 5: Topbar dropdowns (DOCKS / FILTER / LAYERS) and the dock list

**Files:**
- Create: `app/src/modules/console/chrome/TopMenu.tsx`
- Create: `app/src/modules/console/chrome/dockList.ts`
- Create: `app/src/modules/console/chrome/DockList.tsx`
- Create: `app/src/modules/console/chrome/DocksMenu.tsx`
- Create: `app/src/modules/console/chrome/FilterMenu.tsx`
- Create: `app/src/modules/console/chrome/LayersMenu.tsx`
- Test: `app/src/modules/console/chrome/dockList.test.ts`
- Test: `app/src/modules/console/chrome/DockList.test.tsx`
- Source refs: `panels.js:1863-1936` (topMenus open/close/position/outside-click/ESC), `panels.js:1943-2014` (the three menus + label updaters + LAYER_LABELS), `panels.js:2020-2047` (dock search/sort tools), `panels.js:2049-2123` (dockMatchesSearch, dockStateRank, dockListRows, buildDockRow), `panels.js:2311-2361` (renderDockList's grouping + empty note), `panels.js:96-113` (batteryFor/stateFor), `console.css:503-519` + `:619-641` (dock tools + menu variants).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`DATA_DOCKS`, `Engine`, `DockSeed`, `DockState`), `@/shared/store`, `@/modules/console/chrome/{emirates,format}`, `@/modules/console/selection` (`selectEntity`, `selectedDockId`, `inCaptureMode`), `useEngine()`.
- Produces:
  - `dockList.ts` (pure, engine passed in — never read off a global):
    - `hashStr(s: string): number` (panels.js:87-91)
    - `batteryFor(engine: Engine | null, id: string): number` (panels.js:96-102 — live `Math.round(dock.battery)` when the engine has it, else `85 + (hashStr(id) % 15)`)
    - `stateFor(engine: Engine | null, dock: DockSeed): DockState` (panels.js:107-113 — live state, else `'ready'`)
    - `dockMatchesSearch(d: DockSeed, search: string): boolean` (panels.js:2049-2053)
    - `dockStateRank(state: DockState): number` (panels.js:2057-2062)
    - `dockListRows(engine, filter, search, sort): DockSeed[]` (panels.js:2069-2090 — filter, then BATT / STATE / ID(+emirate-cluster) sort, each with the `localeCompare` tiebreak)
    - `groupRows(rows, sort): Array<{ kind: 'group'; emirate: string } | { kind: 'row'; dock: DockSeed }>` — the emirate headers legacy emitted inline in `renderDockList` (panels.js:2350-2358), only under `sort === 'ID'`, so `DockList.tsx` can render a flat list of keyed items.
  - `TopMenu.tsx`: props `{ name: TopMenuName; buttonId: string; extraClass: string; align: 'left' | 'right'; children: ReactNode }`. Ports `openTopMenu`/`closeTopMenu` (panels.js:1865-1936): renders into a portal on `document.body` (`createPortal`) with `className="missions-menu top-menu <extraClass>"`, `role="menu"`, positioned `top: rect.bottom + 6`, and `left: max(8, rect.left)` or `right: max(8, innerWidth - rect.right)`; `hidden` unless `openMenu === name`; a deferred (`setTimeout(..., 0)`) document `mousedown` listener that closes on a click outside both the menu and its trigger; a document `keydown` Escape listener. All listeners removed on close/unmount. Only one menu open at a time is already guaranteed by the single `openMenu` store field.
  - `DockList.tsx`: the `#dock-tools` search input + ID/BATT/STATE sort segment (panels.js:2025-2032 markup verbatim) above `#docklist`. Rows are `<button class="dock-row [sel]" data-dock-id>` with the `.sd`/`.di`/`.dr` spans exactly as `buildDockRow` (panels.js:2099-2102). A row click is the port of panels.js:2105-2121: bail with a 2 s `title="EXIT CURRENT MODE FIRST"` while `inCaptureMode()`; otherwise select the airborne drone `D-<dockId>` if one exists and is not `'docked'`, else the dock; then close the DOCKS menu. Empty result renders `<div class="lbl empty-note">NO DOCKS MATCH THIS FILTER</div>`. Live battery/state refresh comes from a 2000ms interval that bumps a local counter (legacy's 2 s poll, panels.js:2735-2737) — and only while the menu is open, matching legacy's closed-menu no-op guard at panels.js:2319-2322.
  - `DocksMenu.tsx` / `FilterMenu.tsx` / `LayersMenu.tsx`: the three `<TopMenu>` instances. FILTER renders the 11 `.fchip` buttons from `FILTER_KEYS` (`.on` for the active one) and closes on pick. LAYERS renders `.mm-item` radio rows for DARK/LIGHT/SATELLITE/TERRAIN with `aria-checked` and the `✓` in `.mm-check`, calls `setLayer`, and closes.

- [ ] **Step 1: Write the failing `dockList.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { batteryFor, stateFor, dockMatchesSearch, dockStateRank, dockListRows, groupRows } from './dockList'
import { EMIRATE_ORDER } from './emirates'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5)
  return e
}

describe('dock list model', () => {
  it('batteryFor falls back to a deterministic 85..99 hash without an engine', () => {
    const a = batteryFor(null, 'AUH-01')
    expect(a).toBe(batteryFor(null, 'AUH-01'))
    expect(a).toBeGreaterThanOrEqual(85)
    expect(a).toBeLessThanOrEqual(99)
  })

  it('batteryFor and stateFor read live engine state when present', () => {
    const e = bootedEngine()
    const seed = DATA_DOCKS[0]
    expect(batteryFor(e, seed.id)).toBe(Math.round(e.docks.get(seed.id)!.battery))
    expect(stateFor(e, seed)).toBe(e.docks.get(seed.id)!.state)
  })

  it('stateFor defaults to ready without an engine', () => {
    expect(stateFor(null, DATA_DOCKS[0])).toBe('ready')
  })

  it('dockMatchesSearch matches id, name, emirate code and emirate name', () => {
    const d = DATA_DOCKS.find((x) => x.emirate === 'DXB')!
    expect(dockMatchesSearch(d, '')).toBe(true)
    expect(dockMatchesSearch(d, d.id.toLowerCase())).toBe(true)
    expect(dockMatchesSearch(d, 'dubai')).toBe(true)
    expect(dockMatchesSearch(d, 'zzzz')).toBe(false)
  })

  it('dockStateRank orders alert < charging < ready < away (panels.js:2057-2062)', () => {
    expect(dockStateRank('fault')).toBe(0)
    expect(dockStateRank('offline')).toBe(0)
    expect(dockStateRank('charging')).toBe(1)
    expect(dockStateRank('ready')).toBe(2)
    expect(dockStateRank('drone-away')).toBe(3)
  })

  it('the ALL/ID listing keeps every dock, clustered by emirate order', () => {
    const rows = dockListRows(null, 'ALL', '', 'ID')
    expect(rows.length).toBe(DATA_DOCKS.length)
    const seen: number[] = rows.map((d) => EMIRATE_ORDER.indexOf(d.emirate))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('an emirate filter keeps only that emirate', () => {
    const rows = dockListRows(null, 'DXB', '', 'ID')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((d) => d.emirate === 'DXB')).toBe(true)
  })

  it('BATT sort is lowest-charge-first', () => {
    const rows = dockListRows(null, 'ALL', '', 'BATT')
    const batts = rows.map((d) => batteryFor(null, d.id))
    expect(batts).toEqual([...batts].sort((a, b) => a - b))
  })

  it('groupRows emits emirate headers only under ID sort', () => {
    const rows = dockListRows(null, 'ALL', '', 'ID')
    const grouped = groupRows(rows, 'ID')
    expect(grouped.filter((g) => g.kind === 'group').length).toBe(EMIRATE_ORDER.length)
    expect(groupRows(rows, 'BATT').every((g) => g.kind === 'row')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `dockList.ts` to green**

9/9 pass.

- [ ] **Step 3: Write the failing `DockList.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import DockList from './DockList'
import { DATA_DOCKS } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'

describe('DockList', () => {
  beforeEach(() => {
    useAppStore.setState({
      dockFilter: 'ALL',
      dockSearch: '',
      dockSort: 'ID',
      selection: null,
      rightPanel: { mode: 'empty' },
      openMenu: 'docks',
    })
  })

  it('renders one row per dock plus emirate group headers', () => {
    render(<DockList />)
    expect(document.querySelectorAll('.dock-row').length).toBe(DATA_DOCKS.length)
    expect(document.querySelectorAll('.dock-group').length).toBeGreaterThan(0)
  })

  it('search narrows the list and shows the empty note when nothing matches', () => {
    render(<DockList />)
    const input = screen.getByLabelText('Search docks')
    act(() => { fireEvent.input(input, { target: { value: 'zzzz' } }) })
    expect(document.querySelectorAll('.dock-row').length).toBe(0)
    expect(screen.getByText('NO DOCKS MATCH THIS FILTER')).toBeTruthy()
  })

  it('clicking a row with no airborne drone selects the dock and closes the menu', () => {
    render(<DockList />)
    const row = document.querySelector('.dock-row') as HTMLButtonElement
    const id = row.dataset.dockId!
    act(() => { row.click() })
    expect(useAppStore.getState().selection).toEqual({ type: 'dock', id })
    expect(useAppStore.getState().openMenu).toBe(null)
  })

  it('marks the selected dock row', () => {
    useAppStore.setState({ selection: { type: 'dock', id: DATA_DOCKS[0].id } })
    render(<DockList />)
    const sel = document.querySelector('.dock-row.sel') as HTMLElement
    expect(sel.dataset.dockId).toBe(DATA_DOCKS[0].id)
  })

  it('switching sort to BATT drops the emirate headers', () => {
    render(<DockList />)
    act(() => { screen.getByRole('button', { name: 'BATT' }).click() })
    expect(document.querySelectorAll('.dock-group').length).toBe(0)
  })
})
```

`DockList` reads the engine via `useEngine()`, so the test must render it inside a provider — or, simpler and preferred: have `DockList.tsx` accept `engine: Engine | null` as an optional prop defaulting to `useEngine().engineRef.current`. Choose whichever keeps the test free of an `EngineProvider` harness and note the choice in a comment.

- [ ] **Step 4: Run it, confirm it fails, implement `DockList.tsx` + the three menus + `TopMenu.tsx` to green**

5/5 pass.

- [ ] **Step 5: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/chrome/
git commit -m "feat: DOCKS/FILTER/LAYERS dropdowns and the dock list (Phase 1D)"
```

---

### Task 6: Sidebar — live network tile, national grid stats, flight requests board

**Files:**
- Create: `app/src/modules/console/chrome/Sidebar.tsx`
- Create: `app/src/modules/console/chrome/LiveNetworkTile.tsx`
- Create: `app/src/modules/console/chrome/requestBoard.ts`
- Create: `app/src/modules/console/chrome/RequestBoard.tsx`
- Modify: `app/src/modules/console/hud/GridStats.tsx`
- Modify: `app/src/modules/console/hud/hud.css`
- Test: `app/src/modules/console/chrome/requestBoard.test.ts`
- Test: `app/src/modules/console/chrome/RequestBoard.test.tsx`
- Source refs: `console.html:44-76` (sidebar DOM), `panels.js:2550-2558` (wireLiveNetwork), `panels.js:1146-1267` (REQ_PRI_CLASS, requestBuckets, requestMission, reqAgeStr, missionTypeLabel, reqRowHTML, reqProgressHTML, reqDoneHTML), `panels.js:1313-1342` (renderRequestList's badge + empty note + sections), `panels.js:1351-1374` (wireRequestList's row clicks), `console.css:555-583` + `:642-654` (request styles).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`Engine`, `FlightRequest`, `Mission`, `MISSIONS_CONFIG`, `DATA_SITES`), `@/shared/store`, `@/modules/console/chrome/format`, `@/modules/console/selection`.
- Produces:
  - `requestBoard.ts` (pure): `REQ_PRI_CLASS`, `REQ_DONE_MAX = 6`, `byNewestRequested`, `requestBuckets(engine): { pending: FlightRequest[]; active: FlightRequest[]; done: FlightRequest[] }`, `requestMission(engine, req, sessionMissions): Mission | null`, `reqAgeStr(engine, req): string`, `missionTypeLabel(type): string`, `reqProgress(engine, req): { active: boolean; pct: number; eta: string }`. `sessionMissions` is Phase 1E's MEDIA library list — accept it as a parameter defaulting to `[]` and comment that 1E supplies it.
  - `RequestBoard.tsx`: the `.panel.side-requests` block from `console.html:58-75` — `<h4 class="lbl">Flight requests <span id="req-count" class="req-count" hidden>` + `#reqboard` with `#req-empty` and the three `.req-sec` sections (New / In progress / Delivered), each hidden when empty. Rows transcribe `reqRowHTML`/`reqProgressHTML`/`reqDoneHTML` markup (priority chip, customer, age/ETA, `.req-line`, `.req-bar`). Declined rows render as an inert `<div class="req-row req-done req-declined">`; an unreachable completed row renders `<div class="req-row req-done req-inert">`. Refresh runs on a 2000ms interval (legacy's poll) plus an `engine.onEvent` subscription for `FLIGHT_REQUEST` / `REQUEST_*` codes (panels.js:1444-1459) so a new request lands immediately; both cleaned up on unmount, the subscription via `engine.offEvent`. Row clicks port panels.js:1354-1373: `pending` -> `map.flyTo({ center: req.coords, zoom: 12.2 })` and (Phase 1E) the review panel — for now fly the camera and leave a `// Phase 1E: setRightPanel('request', req.id)` comment; `approved` -> `selectEntity({ type: 'drone', id: 'D-' + mission.dockId })` when that drone exists; `completed` -> `// Phase 1E: openDebrief(mission)` (no-op).
  - `LiveNetworkTile.tsx`: `console.html:45-48` verbatim — `role="button" tabIndex={0}`, heading `Live network · N sites` where N is `DATA_SITES.length`, and the LIVE/PLANNED/REPLACE counts computed from `DATA_SITES` statuses (`installed`/`not-installed`/`replace`) rather than the hardcoded 13/4/2. Click and Enter/Space fly the map to `[54.9, 24.3]` zoom `8.3` (panels.js:2553-2557).
  - `Sidebar.tsx`: the `<aside id="side">` children in `console.html:44-76` order — `<LiveNetworkTile/>`, the National grid `.panel` wrapping `<GridStats/>`, `<RequestBoard/>`.
  - `GridStats.tsx` loses its own fixed `#grid-stats-panel` wrapper and `hud-panel` class, rendering just `<div class="stats" id="grid-stats">` with its four tiles; the surrounding `.panel` + `<h4 class="lbl">National grid</h4>` moves into `Sidebar.tsx`. Delete the now-dead `#grid-stats-panel` / `.hud-panel` rules from `hud.css` (the `.stats`/`.st` rules move to `chrome.css` in Task 2 — if Task 2 already carried them, delete them here instead of duplicating).

- [ ] **Step 1: Write the failing `requestBoard.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { requestBuckets, reqAgeStr, missionTypeLabel, REQ_DONE_MAX } from './requestBoard'

function engineWithRequests() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 2000; i++) e.tick(0.5) // ~1000 sim seconds: requests spawn
  return e
}

describe('request board model', () => {
  it('returns empty buckets without an engine', () => {
    expect(requestBuckets(null)).toEqual({ pending: [], active: [], done: [] })
  })

  it('buckets every engine request by status, newest first, capping DELIVERED', () => {
    const e = engineWithRequests()
    const b = requestBuckets(e)
    const total = [...e.requests.values()]
    expect(b.pending.every((r) => r.status === 'pending')).toBe(true)
    expect(b.active.every((r) => r.status === 'approved')).toBe(true)
    expect(b.done.every((r) => r.status === 'completed' || r.status === 'declined')).toBe(true)
    expect(b.done.length).toBeLessThanOrEqual(REQ_DONE_MAX)
    expect(b.pending.length + b.active.length).toBeLessThanOrEqual(total.length)
    const ts = b.pending.map((r) => r.requestedAt)
    expect(ts).toEqual([...ts].sort((a, b2) => b2 - a))
  })

  it('reqAgeStr renders T+M:SS from sim time', () => {
    const e = engineWithRequests()
    const r = [...e.requests.values()][0]
    if (r) expect(reqAgeStr(e, r)).toMatch(/^T\+\d+:\d{2}$/)
  })

  it('missionTypeLabel uses MISSIONS_CONFIG labels and falls back to uppercase', () => {
    expect(missionTypeLabel('security')).toBeTruthy()
    expect(missionTypeLabel('security')).not.toBe('SECURITY_UNKNOWN')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, implement `requestBoard.ts` to green**

- [ ] **Step 3: Write `RequestBoard.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RequestBoard from './RequestBoard'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'

describe('RequestBoard', () => {
  it('paints the empty state with no engine', () => {
    render(<RequestBoard engine={null} />)
    expect(screen.getByText('NO REQUESTS YET · GRID AT READINESS')).toBeTruthy()
    expect(document.getElementById('req-count')?.hasAttribute('hidden')).toBe(true)
  })

  it('renders a section per non-empty bucket once the engine has requests', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 2000; i++) e.tick(0.5)
    render(<RequestBoard engine={e} />)
    const rows = document.querySelectorAll('.req-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(document.getElementById('req-empty')?.hasAttribute('hidden')).toBe(true)
  })
})
```

`RequestBoard` therefore takes an optional `engine` prop defaulting to `useEngine().engineRef.current`, same pattern as `DockList`.

- [ ] **Step 4: Implement `RequestBoard.tsx`, `LiveNetworkTile.tsx`, `Sidebar.tsx`, and the `GridStats` move; run to green**

- [ ] **Step 5: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/chrome/ app/src/modules/console/hud/
git commit -m "feat: sidebar with live network, grid stats and flight requests board (Phase 1D)"
```

---

### Task 7: Right panel — ops digest, dock, site and drone modes

**Files:**
- Create: `app/src/modules/console/panels/panels.css`
- Create: `app/src/modules/console/panels/RightPanel.tsx`
- Create: `app/src/modules/console/panels/opsDigest.ts`
- Create: `app/src/modules/console/panels/OpsDigest.tsx`
- Create: `app/src/modules/console/panels/DockPanel.tsx`
- Create: `app/src/modules/console/panels/SitePanel.tsx`
- Create: `app/src/modules/console/panels/dronePanel.ts`
- Create: `app/src/modules/console/panels/DronePanel.tsx`
- Create: `app/src/modules/console/panels/FpvFrame.tsx`
- Test: `app/src/modules/console/panels/opsDigest.test.ts`
- Test: `app/src/modules/console/panels/dronePanel.test.ts`
- Test: `app/src/modules/console/panels/RightPanel.test.tsx`
- Source refs: `panels.js:126-149` (DETECTION_SUFFIXES/isDetectionEvent), `panels.js:157-215` (digestActiveMissions/digestStatsLine/digestMissionRowsHTML/lastDetections), `panels.js:228-275` (detection rows + renderEmptyPanel), `panels.js:280-315` (updateOpsDigest's 1 Hz patch), `panels.js:317-337` (renderDockPanel), `panels.js:341-385` (SITE_STATUS_CHIP/nearestDockTo/renderSitePanel), `panels.js:389-464` (missionLineFor + FPV frame), `panels.js:469-511` (syncFpvFeed/wireFpvFeed), `panels.js:513-554` (renderDronePanel), `panels.js:561-628` (updateDroneTelemetry 2 Hz), `panels.js:1480-1489` (activeTrackCount), `panels.js:1635-1712` (dock/drone/site panel actions), `panels.js:2405-2437` (setRightPanel), `console.css:197-296` + `:473-492` (right-panel + telemetry + FPV + digest styles).

**Interfaces:**
- Consumes: `@/modules/console/domain`, `@/shared/store`, `@/modules/console/chrome/{format,emirates}`, `@/modules/console/selection`, `useEngine()`, `useMap()`.
- Produces:
  - `opsDigest.ts` (pure): `DETECTION_SUFFIXES`, `isDetectionEvent(ev)`, `activeTrackCount(engine)`, `digestActiveMissions(engine): Mission[]` (active only, newest `startedAt` first, capped at `DIGEST_MISSIONS_CAP = 8`), `digestStatsLine(engine): string` (the exact `AIRBORNE n · READY n[ · TRACKS n] · ALERTS n` format, and the no-engine literal `104 DOCK STATIONS ONLINE · ALL 7 EMIRATES`), `lastDetections(engine, n): SimEvent[]`, `detectionBody(ev): string` (the `msg.slice(source.length + 1)` strip at panels.js:242).
  - `dronePanel.ts` (pure): `missionLineFor(engine, drone): string` (panels.js:389-399), `fpvSources(engine, drone): string[]` (panels.js:422-428 — `${import.meta.env.BASE_URL}videos/${file}`, NOT a bare `videos/` relative path, because the app is served under a base path), `FPV_LIVE_STATES`, `fpvCruising(drone)`, `distHomeKm(engine, drone): number`, `rtbDisabled(drone)`, `holdDisabled(drone)`, `controlDisabled(drone)` (the exact state-array predicates at panels.js:519-523).
  - `RightPanel.tsx`: reads `rightPanel` from the store and renders `<OpsDigest/>` for `'empty'`, `<DockPanel id/>`, `<SitePanel id/>`, `<DronePanel id/>`. Unknown modes fall back to `<OpsDigest/>` (panels.js:2423 + :2431's "any unknown mode fell back to the empty renderer"). Each mode component owns its own refresh interval in an effect, so unmount cleans it up — this replaces legacy's `droneTeleTimer`/`digestTimer` module globals and the manual clearing at panels.js:2409-2415. Add a comment saying so. Phase 1E's `request`/`track`/`debrief`/`media`/`wizard` modes will be added to the union and this switch.
  - `OpsDigest.tsx`: `#ops-digest` with the stats line, `Active missions` rows (`.digest-row` with `.dg-head`/`.dg-type`/`.dg-eta`/`.dg-id`/`.dg-prog > i`), and `Last detections` (3) rows. Refreshes on a 1000ms interval. A mission row click selects `D-<mission.dockId>` when that drone is airborne (panels.js:1832-1838). A detection row whose track is still `active`/`tasked` renders as `<button class="dg-det dg-det-track">` and is a `// Phase 1E: focusTrack` seam (render the button, leave the handler a documented no-op) — a non-track detection stays an inert `<div class="dg-det">`.
  - `DockPanel.tsx`: `renderDockPanel` (panels.js:317-337) as JSX — `.rp-id`, `.rp-name`, `.rp-emirate` (via `EMIRATE_NAMES`), Drone model / Battery `.rp-kv` rows, `.batt-bar`, `.state-chip` with the uppercased live state, and `.rp-actions` with `#rp-launch` (disabled unless `state === 'ready'`, with the `DRONE NOT AVAILABLE AT THIS DOCK` title when disabled; the click is a `// Phase 1E: enterWizard(dockId)` seam, so also disable it unconditionally for now and say why) and `#rp-locate` (`map.flyTo({ center: dock.coords, zoom: 14 })`). Refreshes on the 1000ms interval so battery/state stay live.
  - `SitePanel.tsx`: `renderSitePanel` (panels.js:361-385) as JSX, including `SITE_STATUS_CHIP`, `nearestDockTo` (panels.js:350-359, using `SimRouter.distM`), the `SURVEY SITE` vs `DISPATCH INSPECTION` label, and the three actions. `#rp-site-locate` and `#rp-site-dock` are fully wired (the latter via `selectEntity`); `#rp-site-dispatch` transcribes panels.js:1717-1740's `engine.launchPreset('infra', { near: site.coords })` flow — read those lines and port the whole handler including its ticker advisories on failure and the follow-the-launched-drone success path. (`launchPreset` is domain API that already exists, so this one is NOT a 1E seam.)
  - `DronePanel.tsx` + `FpvFrame.tsx`: `renderDronePanel` (panels.js:513-554) + the 2 Hz live refresh (panels.js:561-628) as a 500ms interval driving a re-render from live engine state. `FpvFrame` owns the `<video>` element: it mounts the video only while `fpvCruising(drone) && sources.length > 0` (legacy's `syncFpvFeed`, panels.js:469-490), chains multiple clips on `ended`/`error` (panels.js:495-511), and uses the `loop` attribute for a single clip. Actions: `#rp-follow` toggles `followDroneId` and eases the camera when turning on (panels.js:1654-1665); `#rp-rtb` calls `engine.commandRTB`; `#rp-hold` calls `engine.commandHold(id, d.state !== 'hold')`; `#rp-control` and the `#rp-alt-row` +/- buttons render exactly as legacy but `#rp-control` is disabled with a `// Phase 1E: enterManual` comment (the alt row only appears in `manual` state, which is unreachable until 1E, so it is inert by construction — note that too).
  - `panels.css`: the `.rp-*` / `.state-chip` / `.batt-bar` / `.tele-*` / `.fpv-*` / `.digest-*` / `.dg-*` rules from `console.css:197-296` and `:473-492`, plus `.state-chip.steel|.dim` from `:594-595` and `button.dg-det-track` from `:609-617`.

- [ ] **Step 1: Write the failing `opsDigest.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { digestStatsLine, digestActiveMissions, lastDetections, isDetectionEvent, detectionBody } from './opsDigest'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 1200; i++) e.tick(0.5)
  return e
}

describe('ops digest model', () => {
  it('shows the static line without an engine (panels.js:173)', () => {
    expect(digestStatsLine(null)).toBe('104 DOCK STATIONS ONLINE · ALL 7 EMIRATES')
  })

  it('derives the live stats line from engine state', () => {
    const e = bootedEngine()
    let ready = 0, alerts = 0, airborne = 0
    for (const d of e.docks.values()) {
      if (d.state === 'ready') ready++
      else if (d.state === 'fault' || d.state === 'offline') alerts++
    }
    for (const d of e.drones.values()) if (d.state !== 'docked') airborne++
    const line = digestStatsLine(e)
    expect(line).toContain('AIRBORNE ' + airborne)
    expect(line).toContain('READY ' + ready)
    expect(line).toContain('ALERTS ' + alerts)
  })

  it('lists at most 8 active missions, newest first', () => {
    const e = bootedEngine()
    const ms = digestActiveMissions(e)
    expect(ms.length).toBeLessThanOrEqual(8)
    expect(ms.every((m) => m.state === 'active')).toBe(true)
    const t = ms.map((m) => m.startedAt)
    expect(t).toEqual([...t].sort((a, b) => b - a))
  })

  it('recognises detection events and strips the leading source id', () => {
    const e = bootedEngine()
    const dets = lastDetections(e, 3)
    expect(dets.length).toBeLessThanOrEqual(3)
    for (const d of dets) {
      expect(isDetectionEvent(d)).toBe(true)
      expect(detectionBody(d).startsWith(d.source + ' ')).toBe(false)
    }
  })

  it('rejects non-detection events', () => {
    expect(isDetectionEvent({ time: 0, level: 'alert', source: 'AUH-01', message: 'DOCK FAULT' })).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing `dronePanel.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { missionLineFor, fpvCruising, rtbDisabled, holdDisabled, distHomeKm } from './dronePanel'
import type { Drone } from '@/modules/console/domain'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
}
const stub = (state: Drone['state']): Drone => ({ state } as Drone)

describe('drone panel model', () => {
  it('missionLineFor prefixes the mission label and percent when on a mission', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.missionId && x.state !== 'docked')
    if (d) expect(missionLineFor(e, d)).toMatch(/·\s\d+%\s·/)
  })

  it('missionLineFor falls back to the state label with no mission', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.state === 'docked')!
    expect(missionLineFor(e, d)).toBe('DOCKED')
  })

  it('fpvCruising matches FPV_LIVE_STATES exactly (panels.js:434)', () => {
    for (const s of ['transit', 'on-task', 'rtb', 'hold', 'manual'] as const) {
      expect(fpvCruising(stub(s))).toBe(true)
    }
    for (const s of ['docked', 'takeoff', 'landing'] as const) {
      expect(fpvCruising(stub(s))).toBe(false)
    }
  })

  it('RTB is enabled only in transit/on-task/hold (panels.js:519)', () => {
    expect(rtbDisabled(stub('transit'))).toBe(false)
    expect(rtbDisabled(stub('hold'))).toBe(false)
    expect(rtbDisabled(stub('takeoff'))).toBe(true)
  })

  it('HOLD is enabled while held or in transit/on-task (panels.js:521)', () => {
    expect(holdDisabled(stub('hold'))).toBe(false)
    expect(holdDisabled(stub('on-task'))).toBe(false)
    expect(holdDisabled(stub('landing'))).toBe(true)
  })

  it('distHomeKm is a finite non-negative distance', () => {
    const e = bootedEngine()
    const d = [...e.drones.values()].find((x) => x.state !== 'docked')
    if (d) {
      const km = distHomeKm(e, d)
      expect(Number.isFinite(km)).toBe(true)
      expect(km).toBeGreaterThanOrEqual(0)
    }
  })
})
```

- [ ] **Step 3: Run both, confirm they fail, implement `opsDigest.ts` + `dronePanel.ts` to green**

- [ ] **Step 4: Write `RightPanel.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RightPanel from './RightPanel'
import { SimEngine, DATA_DOCKS, DATA_SITES, GEO_UAE } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'

const engine = (() => {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
})()

describe('RightPanel', () => {
  beforeEach(() => useAppStore.setState({ rightPanel: { mode: 'empty' }, followDroneId: null }))

  it('renders the ops digest by default', () => {
    render(<RightPanel engine={engine} map={null} />)
    expect(document.getElementById('ops-digest')).toBeTruthy()
    expect(screen.getByText(/AIRBORNE/)).toBeTruthy()
  })

  it('renders the dock card for a dock selection', () => {
    const id = DATA_DOCKS[0].id
    useAppStore.setState({ rightPanel: { mode: 'dock', id } })
    render(<RightPanel engine={engine} map={null} />)
    expect(screen.getByText(id)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LOCATE' })).toBeTruthy()
  })

  it('renders the site card with its status chip', () => {
    const site = DATA_SITES[0]
    useAppStore.setState({ rightPanel: { mode: 'site', id: site.id } })
    render(<RightPanel engine={engine} map={null} />)
    expect(screen.getByText(site.name)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'NEAREST DOCK' })).toBeTruthy()
  })

  it('renders the drone telemetry card for a live drone', () => {
    const d = [...engine.drones.values()].find((x) => x.state !== 'docked')!
    useAppStore.setState({ rightPanel: { mode: 'drone', id: d.id } })
    render(<RightPanel engine={engine} map={null} />)
    expect(screen.getByText(d.id)).toBeTruthy()
    expect(document.querySelectorAll('.tele-cell').length).toBe(6)
    expect(screen.getByRole('button', { name: 'FOLLOW' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'RETURN TO DOCK' })).toBeTruthy()
  })
})
```

`RightPanel` takes optional `engine`/`map` props defaulting to the contexts, same pattern as Tasks 5/6.

- [ ] **Step 5: Implement every panel component + `panels.css`; run to green**

- [ ] **Step 6: Verify + commit**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint` — green.

```bash
git add app/src/modules/console/panels/
git commit -m "feat: right panel ops-digest/dock/site/drone modes (Phase 1D)"
```

---

### Task 8: Integration — compose the console, ticker click-through, and ticker events off-route

**Files:**
- Modify: `app/src/modules/console/Console.tsx`
- Modify: `app/src/modules/console/hud/Ticker.tsx`
- Modify: `app/src/modules/console/hud/hud.css`
- Modify: `app/src/modules/console/engine/EngineProvider.tsx`
- Modify: `app/src/modules/console/engine/useLiveLayers.ts`
- Test: `app/src/modules/console/Console.test.tsx` (extend)
- Test: `app/src/modules/console/hud/Ticker.test.tsx` (extend)
- Source refs: `panels.js:2172-2203` (eventDroneId, focusDroneFromEvent, applyDroneActivity), `panels.js:2374-2385` (drone chip tagging in pushEvent), `panels.js:2617-2630` (wireScene's globe-scene teardown), `console.css:406-413` (is-active/is-past/clickable), `console.css:386-395` (#ticker's real left:318px/right:340px inset + collapse reflow).

**Interfaces:**
- Consumes: everything from Tasks 2-7.
- Produces:
  - `Console.tsx` renders `<ConsoleChrome topbar={<Topbar onExitToOrbit={exitToOrbit}/>} sidebar={<Sidebar/>} rightPanel={<RightPanel/>} ticker={<Ticker/>} />` inside `<MapView>`, calls `useMapSelection()` and `useFollowDriver()` alongside the existing `useGlobe`/`usePingDriver`/`useLiveLayers`, and drops the placeholder layer buttons, the fixed `<GridStats/>` mount and the standalone `<OfflineChip/>` (now inside `Topbar`). Add an effect that runs `clearSelection()` whenever `scene` leaves `'console'` (panels.js:2622-2629) and closes any open top menu (`setOpenMenu(null)`, panels.js:2621).
  - `Ticker.tsx` gains the drone click-through: a chip whose `droneId` is set gets `drone-ev` plus `is-active` (drone exists and is not `'docked'`) or `is-past`, recomputed on a 1000ms interval (panels.js:2230-2233); clicking an `is-active` chip runs `focusDroneFromEvent` — set `followDroneId`, `selectEntity({ type: 'drone', id })`, `map.easeTo({ center: drone.pos, zoom: 12.5, duration: 600 })` — guarded by `inCaptureMode()` (panels.js:2180-2189). Move `#ticker` in `hud.css` to its real `left: 318px; right: 340px; bottom: 0; height: 34px; border-radius: 0; border-top: 1px solid var(--line)` with the `body.side-collapsed`/`body.rpanel-collapsed` reflow rules and the `transition:left .28s ease,right .28s ease,opacity .2s ease` from `console.css:386-395`, and restore the `.tick-ev.is-active/.is-past/.clickable` rules from `console.css:404-413`.
  - The ticker-push half of `attachEngineEvents` moves from `useLiveLayers.ts` into `EngineProvider.tsx` (the deferral recorded in the Phase 1C ledger): `EngineProvider` subscribes on `started` and pushes `mapEngineEvent(ev, nowClockStr)` to the store, unsubscribing via `engine.offEvent`; `useLiveLayers` keeps only the launch-FX pulse half (which needs the map). Ticker events then accumulate while the user is on another route.

- [ ] **Step 1: Move the ticker push into `EngineProvider`**

Split `attachEngineEvents`: `EngineProvider.tsx` gets an effect subscribing to `engine.onEvent` for the store push only (no map, no `ready` dependency); `useLiveLayers.ts`'s `attachEngineEvents` keeps only the `MISSION_LAUNCHED` -> `pushLaunchPulse` branch. Update `useLiveLayers.test.tsx` accordingly (its existing assertions about the ticker push move to a new `EngineProvider` test or are re-pointed — read the file and decide, keeping coverage of both halves).

- [ ] **Step 2: Extend `Ticker.test.tsx`**

Add a test that a chip with a `droneId` for a live drone carries `is-active` and, on click, sets `followDroneId` and the drone selection; and that a chip for a docked/absent drone carries `is-past` and does nothing on click. Use a fake engine map (`{ drones: new Map(...) }`) passed as an optional prop, matching the pattern in Tasks 5-7.

- [ ] **Step 3: Rewrite `Console.tsx` and update `hud.css`**

- [ ] **Step 4: Extend `Console.test.tsx`**

Assert the console scene renders `#topbar`, `#side`, `#rpanel`, `#ticker`, `#side-toggle`, `#rpanel-toggle`, and that the globe scene renders them `hidden`. Follow the existing test file's mocking approach for MapLibre — read it first.

- [ ] **Step 5: Full verification in the browser**

From `app/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` — green. Then `npm run dev`, open `/console`, dive into the theater, wait ~20s and confirm functionally (the pane does not composite frames, so assert rather than screenshot) via `javascript_tool`:
- `document.querySelectorAll('#topbar,#side,#rpanel,#ticker').length === 4` and none `hidden`
- `document.querySelectorAll('.st').length === 4` and `#ops-digest` present
- clicking `#btn-docks` opens `#docks-menu` with `document.querySelectorAll('.dock-row').length === 104`
- clicking a `.dock-row` sets `useAppStore`-visible selection (assert via the DOM: `#rpanel-body .rp-id` textContent equals the clicked dock id) and closes the menu
- after ~20s, `document.querySelectorAll('.tick-ev').length > 0` and the digest stats line is not the static fallback
- `read_console_messages` shows no errors

Then `npm run preview` and confirm `http://localhost:4173/e-Sentinel/console` returns 200. Stop both servers.

- [ ] **Step 6: Re-run the legacy suite and commit**

From the repo root: `node --test tests/*.test.js` -> 65/65 (proving `assets/` is untouched).

```bash
git add app/src/modules/console/ app/src/shared/
git commit -m "feat: compose real console chrome, ticker click-through, off-route ticker events (Phase 1D)"
```

---

## Self-Review

**Spec coverage (the Phase 1D scope named in the brief):**
- topbar (brand, chips, DOCKS/FILTER/LAYERS dropdowns, OPS/MISSIONS/NEW MISSION, clock) -> Tasks 4 + 5
- sidebar (live-network tile, grid stats, FLIGHT REQUESTS board) -> Task 6
- right panel modes (ops-digest / dock / drone / site) -> Task 7
- dock list (search, sort, emirate groups) -> Task 5
- filters -> Task 5 (FILTER menu) + Task 1 (`dockFilter` slice)
- panel collapse toggles -> Task 2
- scene chrome fade -> Task 2 (`useChromeFade`)
- `EC2.select` selection state machine -> Task 3
- `--chrome`/`--chrome-blur` tokens + `[data-maplayer]` overrides (carried-in item) -> Task 2
- ticker events dropped off-route (carried-in item) -> Task 8
- domain `onEvent` has no unsubscribe (carried-in item) -> Task 1 (`offEvent`)
- `updater.setRangeHighlight` exposure (carried-in item) -> deliberately NOT in this phase: it is already on the `LiveLayerUpdater` interface and only the 1E wizard needs to reach the instance. Phase 1E's plan owns lifting the updater into context.
- console-route code splitting (carried-in item) -> deliberately deferred to Phase 1F, where the deploy flip makes bundle size actually matter.

**Placeholder scan:** No TBD/TODO. Every Phase 1E seam is named explicitly with the legacy behavior it will carry and the comment text to leave. All test code is given in full; all transcription steps cite exact legacy line ranges.

**Type consistency:** `RightPanelState`/`FilterKey`/`DockSort`/`TopMenuName` are defined in `store.ts` (Task 1) and consumed by Tasks 2-8. `Selection`/`GridStats`/`TickerEvent` are the existing Phase 1C store types, unchanged. `selectEntity(sel, engine, map)` / `clearSelection()` / `selectedDockId(selection)` / `inCaptureMode()` are defined in Task 3 and called with those exact signatures in Tasks 5, 6, 7, 8. `batteryFor(engine, id)` / `stateFor(engine, dock)` are defined in Task 5's `dockList.ts` and reused by Task 7's `DockPanel`. `nowClockStr` is defined once in Task 1's `format.ts` and re-exported from `tickerModel.ts`. `engine.offEvent(cb)` is added in Task 1 and used in Tasks 6 and 8. The optional-`engine`/`map`-prop-defaulting-to-context pattern is introduced in Task 5 and used identically in Tasks 6, 7 and 8.
