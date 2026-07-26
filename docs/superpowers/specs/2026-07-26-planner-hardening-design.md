# Planner Hardening + Module 02 Go-Live — Design

Date: 2026-07-26
Status: approved (user directed "keep working until this is done", so the design gate was
exercised by the controller rather than by a round trip)
Base: `master` @ `9c402eb`

## 1. Purpose

`/planner` (module 02) shipped functional but carries six recorded follow-ups from the
planner branch's final review, none blocking individually, all of them together the
difference between "works when driven carefully" and "safe to hand to a customer".
This spec closes them and flips the module 02 landing card from IN DEVELOPMENT to ONLINE.

Nothing here adds a feature the planner does not already have, with one exception: the
`LAYERS` basemap control, which the planner spec called for (section 10) and which was
never built.

## 2. Scope

In scope, in the order the follow-ups were recorded:

1. **App-wide React ErrorBoundary.** Two concrete crash paths were closed on the planner
   branch; there is still no net. Any uncaught render error blanks the whole SPA.
2. **`LAYERS` basemap control for the planner** (planner design doc section 10, unbuilt).
3. **`parsePlan` element-level validation.** Malformed *elements* inside `aois`/`docks`
   are still admitted.
4. **`test.globals: true`** so React Testing Library's auto-cleanup registers repo-wide.
5. **Progress/busy state for `SUGGEST LAYOUT`**, which blocks for seconds on large AOIs
   with no acknowledgement that the click registered.
6. **Real-browser verification of the `IMPORT AOI` and `IMPORT PLAN` file pickers**,
   which have only ever been exercised at the domain level.
7. **Module 02 landing card to ONLINE.**

Out of scope: modules 03/04, Higgsfield videos (still blocked on access), the provisional
drone catalog figures, and any change to the coverage/auto-placement algorithms
themselves.

## 3. Item 1 — ErrorBoundary

### Placement

React error boundaries must be class components, and they replace their entire subtree
when they catch. That makes placement load-bearing against the project's oldest
invariant: `<EngineProvider>` sits above `<Routes>` so the sim engine is a page-lifetime
singleton that survives route changes.

A boundary *above* `EngineProvider` would, on catching, unmount the provider and kill the
running simulation — turning a recoverable route crash into a total loss of sim state.

The boundary therefore goes **inside `EngineProvider`, wrapping `<Suspense>` and
`<Routes>`**:

```
BrowserRouter
  EngineProvider          <- never unmounts (existing invariant)
    ErrorBoundary         <- new
      Suspense
        Routes
```

A crash in a route element is contained; the engine keeps ticking behind the fallback.
A crash inside `EngineProvider` itself is not caught — accepted, because that provider is
a thin context wrapper whose render body does nothing that can throw, and because
catching it would require the placement that kills the engine.

### Recovery

The boundary does **not** try to reset itself in place. A component that just threw
during render is not reliably re-renderable, and a silent retry that throws again looks
to the user like a frozen button.

Recovery is explicit and coarse:

- `RELOAD` — `window.location.reload()`.
- `← MODULES` — a hard navigation to `import.meta.env.BASE_URL` (not a client-side
  `<Link>`, which would keep the broken tree's module state in memory).

Both are full document loads, so they are guaranteed to work regardless of what state the
crash left behind.

### Fallback UI

Console/planner visual language: dark, `--chrome` glass panel, mono micro-labels at
9.5px/.22em uppercase, e& wordmark. Red `#ff5a5a` is permitted here — an unrecoverable
application fault is exactly the alert case the brand rule reserves it for. No em dashes
in copy.

Content: `SYSTEM FAULT`, one line of plain explanation, the error's `message` in a mono
block (message only, never the stack — the stack is `console.error`'d instead), and the
two recovery controls.

### Diagnostics

`componentDidCatch` logs `console.error('[sentinel] uncaught render error', error, info)`
so the component stack survives in the console for anyone debugging, matching the
`[planner]` / `[coverage]` logging convention already in the codebase.

## 4. Item 2 — Planner LAYERS control

### The defect being fixed

The planner builds its style over `buildBaseStyle()`, which contains all four basemap
raster layers, but nothing in the planner ever sets their visibility. The planner
therefore renders whatever the *console's* `useBasemap` last applied to its own map
instance — except style state is per-map, so in practice a freshly loaded `/planner`
shows the raster stack in its style-declared default state, while a `/planner` reached
after visiting `/console` can differ.

It is worse than cosmetic: `shared/tokens.css` keys `--chrome` off
`:root[data-maplayer=…]`, and `planner.css` uses `var(--chrome)` for the topbar, panels
and summary strip. The planner never stamps `data-maplayer`, so its glass chrome is
themed by whatever the console left on `<html>` — dark chrome over a light basemap is a
real legibility failure, not a nuance.

### Shared-fact risk, and how it is closed

This is exactly the shape that produced this project's two worst bugs (the id counter,
and `autoPlace` hardcoding `environment: 'rural'`): two independently-correct call sites
disagreeing about a shared fact. Here the shared fact is "what does basemap X mean".

So the basemap *application* logic is extracted, not duplicated. `console/map/basemap.ts`
(which already owns `effectiveLayer`, `DARK_OVERLAY_IDS`, `OPERATIONAL_LAYER_IDS`) gains
two exported functions moved verbatim out of `useBasemap.ts`:

- `applyRasterVisibility(map, eff)` — the four `raster-*` visibility sets plus the
  `DARK_OVERLAY_IDS` toggle.
- `applyPlaceLabelTheme(map, eff)` — the `uae-places` text/halo retint.

`useBasemap` is rewritten to call them. Its observable behaviour must not change; that is
a hard requirement of this item, verified by the console's existing tests plus a browser
check of `/console`.

### The one deliberate divergence

`useBasemap` computes `eff = offline ? null : effectiveLayer(scene, layer)`. `scene` is
the console's globe/console scene, and `effectiveLayer` forces `sat` while the globe is
up. The planner has no globe and no scene, so it must **not** consult `scene`: a user who
loads `/planner` first (store default `scene === 'globe'`) would otherwise get satellite
imagery regardless of their pick.

`usePlannerBasemap` computes `eff = offline ? null : layer` and does not touch
`OPERATIONAL_LAYER_IDS` (the planner has no sim layers to hide). It stamps
`document.documentElement.dataset.maplayer = layer`, same as the console, so `--chrome`
tracks the basemap.

This divergence is stated in both hooks' comments so a future reader sees it is intended.

### Store

Reuses `useAppStore`'s existing `layer` / `setLayer`. No new store. The planner's own
Zustand store stays plan-only; basemap choice is an app-level display preference already
modelled there, and sharing it means a user's pick carries between the two modules, which
is the behaviour a single product should have.

### UI

`PlannerLayersMenu`, rendered in `PlannerTopbar` immediately before the spacer. It reuses
the topbar's existing `pl-dropdown` / `pl-menu` / `pl-menu-item` pattern (the same one
`DRAW ▾` uses) rather than importing the console's `TopMenu`, which is bound to the
console's `openMenu` store slice and `#topbar` ids. Labels and order are taken verbatim
from the console's `LayersMenu`: `DARK` / `LIGHT` / `SATELLITE` / `TERRAIN`, active row
check-marked, picking one closes the menu.

Only one topbar dropdown may be open at a time.

## 5. Item 3 — parsePlan element validation

### Current state, restated precisely

The existing comment claims a malformed element "fails safely downstream". That is not
true today: `parsePlan`'s own return path runs

```ts
plan.aois.map((aoi) => ({ ...aoi, valid: isValidAoiGeometry(aoi.geometry) }))
```

so `{"aois": [null], …}` throws a `TypeError` *inside `parsePlan` itself*. On the
autosave path that throw is swallowed by `loadAutosave`'s try/catch (degrades to "no
saved plan"). On the `IMPORT PLAN` path there is no try/catch, so it becomes an unhandled
rejection out of an async handler. The item is therefore a genuine correctness gap, not
just defence in depth.

### Design

Validate every element before the plan is admitted, and reject the whole file with a
reason that names the offending index. Partial acceptance is explicitly rejected as a
design choice: silently dropping element 3 of a customer's plan is worse than refusing
the file, because the user would have no way to know their plan came back smaller than
it went in.

`Aoi` requires: object; `id`, `name` non-empty strings; `source` one of
`drawn | kml | kmz`; `geometry` an object whose `type` is `Polygon` or `MultiPolygon`
with a `coordinates` array whose leaf positions are pairs of finite numbers.

`PlannedDock` requires: object; `id`, `name` non-empty strings; `position` a
`[lon, lat]` pair of finite numbers within `[-180, 180]` / `[-90, 90]`;
`dockModel`, `droneModel` non-empty strings; `environment` exactly `urban` or `rural`;
`source` one of `manual | auto`.

`dockModel` / `droneModel` are **not** checked against the catalog. The Inspector already
handles an unknown or incompatible pairing explicitly (renders the stored value as a
marked option with an alert badge, added in planner Task 12), and rejecting an entire
plan because one dock names a model this build has not shipped yet would be a worse
failure than the one the Inspector already handles well.

`valid` is ignored on input and re-derived, exactly as it is today.

Messages follow the existing style: `PLAN CONTAINS AN INVALID AREA AT INDEX 2`,
`PLAN CONTAINS AN INVALID DOCK AT INDEX 7`.

## 6. Item 4 — vitest globals

`app/vite.config.ts`'s `test` block sets `environment` and `include` but not `globals`, so
`afterEach` is not a global, so `@testing-library/react`'s auto-cleanup never registers.
Every rendering test that does not call `cleanup()` itself leaks its mounts into later
tests in the same file.

Fix: add `globals: true`. Existing explicit `cleanup()` calls stay — `cleanup()` is
idempotent, removing them is churn with no benefit, and leaving them means the files that
already got this right do not regress if the config is ever changed back.

No `tsconfig` change is needed: every test file imports `describe`/`it`/`expect` from
`vitest` explicitly, so no ambient global types are required.

The success criterion is that the full suite stays green *and* that the one file
identified as rendering without an explicit cleanup
(`console/chrome/useChromeFade.test.tsx`) still passes, since it is the file whose
behaviour this change actually alters.

## 7. Item 5 — SUGGEST LAYOUT busy state

`suggestLayout` is synchronous and CPU-bound. On a large AOI it blocks the main thread for
seconds; the click appears to do nothing.

A spinner cannot animate while the main thread is blocked, so this design does not pretend
otherwise. Two honest options were considered:

- **Web Worker.** Correct, keeps the UI live, but the planner domain would need a worker
  entry, a message protocol, and structured-clone-safe plan transfer — significant new
  surface for a demo-grade tool, and it introduces an async path into a currently
  synchronous flow that several tests depend on.
- **Yield-then-compute** (chosen). Set a `busy` flag, let the browser paint it, then run
  the synchronous work and clear the flag.

Yield-then-compute is chosen. It costs one small state field, changes no algorithm, and
turns "dead click" into "visibly working, briefly unresponsive" — which is an accurate
description of what is happening.

Mechanism: `setBusy(true)`, then a double `requestAnimationFrame` before the compute. One
rAF schedules the callback *before* the next paint; two guarantees the busy state has
actually been painted. `setTimeout(0)` is not used, since a macrotask carries no such
guarantee relative to paint.

While busy, `SUGGEST LAYOUT` is `disabled` and reads `PLACING DOCKS`. The rAF handles are
cancelled on unmount, and the compute callback bails if the component unmounted, so a
navigation mid-compute cannot `setState` on a dead component.

A comment records that the main thread still blocks, and that a worker is the escalation
if AOI sizes grow.

## 8. Item 6 — File-picker browser verification

`IMPORT AOI` and `IMPORT PLAN` are the only user-facing paths never exercised in a real
browser. They are verified, not rewritten, unless verification finds a defect.

Method: Playwright MCP against the dev server. Click the topbar button, satisfy the file
chooser with a fixture, assert the resulting on-screen state.

Fixtures: `src/modules/planner/io/fixtures/simple.kml` already exists for the AOI path.
The plan path uses a JSON file exported from the planner itself in the same session, which
also verifies the export/import round trip end to end rather than against a hand-written
fixture that could drift from what `serializePlan` really emits.

Both success and failure paths are checked: a `.json` fed to `IMPORT AOI` must produce the
typed error alert, not a crash.

## 9. Item 7 — Landing card

`app/src/modules/landing/modules.ts`, module 02: `status: 'dev'` → `'online'`,
`statusLabel: 'IN DEVELOPMENT'` → `'ONLINE'`. `enabled` is already `true`.

The blurb keeps `AI CO-PLANNER` even though no AI co-planner exists. This is a deliberate
carry-over of the legacy marketing copy the landing page was ported from 1:1, and the
card describes the module's intent. Flagged here so the decision is recorded rather than
discovered later; changing it is a one-line edit if the user prefers.

## 10. Testing

Per item:

| Item | Test |
|---|---|
| ErrorBoundary | A child that throws renders the fallback, not a blank tree; a non-throwing child renders normally; `console.error` is called. |
| basemap extraction | Existing console basemap tests must pass unmodified. New tests: `applyRasterVisibility` sets exactly one raster visible; planner hook ignores `scene`, so `scene: 'globe'` + `layer: 'light'` yields `light`, not `sat`; stamps `data-maplayer`. |
| parsePlan | One rejection test per invalid-element shape, including the literal `[null]` case from the follow-up; a valid plan with both arrays populated still round-trips. |
| globals | Whole-suite green; no new test. |
| busy state | Clicking `SUGGEST LAYOUT` disables the button and shows `PLACING DOCKS` before the compute runs, and restores after. |

All tests that render must keep working with auto-cleanup now active.

## 11. Verification gate

The project's standing gate, run by the controller on the merged result:

- `npm test` (app), `node --test tests/*.test.js` (legacy 65)
- `npm run typecheck`, `npm run lint` (`--max-warnings 0`), `npm run format:check`,
  `npm run build`
- Entry chunk must stay at ~216.9kB. The ErrorBoundary is the only addition that lands in
  the entry chunk; it is a small class component with no new dependencies.
- Browser: `/console` unaffected (basemap extraction is the risk), `/planner` LAYERS
  switches basemap and re-themes chrome, both file pickers work, `SUGGEST LAYOUT` shows
  its busy state, landing shows module 02 ONLINE, 0 console errors.

## 12. Non-goals, recorded

- No Web Worker for auto-placement.
- No catalog-membership validation in `parsePlan`.
- No boundary above `EngineProvider`.
- No change to the `AI CO-PLANNER` blurb.
- Drone catalog figures stay provisional.
