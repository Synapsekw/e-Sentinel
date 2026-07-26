# Planner Hardening + Module 02 Go-Live Implementation Plan

Spec: `docs/superpowers/specs/2026-07-26-planner-hardening-design.md`
Base: `master` @ `9c402eb`
Branch: `feature/planner-hardening`

Seven recorded follow-ups from the planner branch's final review, plus flipping the
module 02 landing card to ONLINE. No algorithm changes, one new UI control (`LAYERS`).

## Global Constraints

Apply to every task. An implementer that breaks one of these has failed the task even if
its own tests pass.

- **Environment.** Use the Bash tool (Git Bash), not PowerShell, for npm. `app/.npmrc`
  already pins `script-shell` to bash because the repo path contains `&`. Before any
  `git commit`, `export PATHEXT=";$PATHEXT"` so the pre-commit hook can spawn
  eslint/prettier. The hook does **not** run typecheck — run `npm run typecheck` yourself.
- **Scope fence.** Touch only the files your task lists. If you find a defect outside
  them, **report it, do not fix it**. Do not run any git command beyond `git add` and
  `git commit` — no checkout, branch, merge, rebase, reset, push, or stash.
- **Invariants.** `<EngineProvider>` stays above `<Routes>` and must never be able to
  unmount. Map readiness gates on MapView's `ready` latch, never `map.loaded()`. Any map
  access from an effect cleanup uses `isMapUsable(map)`. `planner/domain/` stays pure and
  framework-free.
- **UI rules.** No em dashes in UI copy. Mono micro-labels 9.5px/.22em uppercase. Red
  `#ff5a5a` / `#BC0000` for brand and alerts only.
- **Filesystem is case-insensitive.** Never create two files in one directory differing
  only by case. Pure models are `camelCase.ts`, components `PascalCase.tsx`.
- **No wall-clock assertions in tests.** They measure CI hardware, not the algorithm.
- **Verification before claiming done.** Run `npm test`, `npm run typecheck`,
  `npm run lint` and paste real output. Never claim green without it.
- Tests that render must call `cleanup()` in `afterEach` **unless** Task 1 has landed, in
  which case auto-cleanup is active — keep any existing explicit calls regardless.

## Task order and parallelism

Task 1 lands first alone (it changes test semantics repo-wide, so everything after it is
tested under the final configuration). Tasks 2 and 3 are independent and run in parallel.
Task 4 then Task 5 are sequential — both touch `PlannerTopbar.tsx` and `Planner.tsx`.
Tasks 6 and 7 are the controller's.

---

### Task 1: Enable vitest globals so RTL auto-cleanup registers

**Spec section:** 6

**Files:** `app/vite.config.ts` only.

**Problem.** The `test` block sets `environment` and `include` but not `globals`, so
`afterEach` is not defined as a global, so `@testing-library/react`'s auto-cleanup never
registers. Rendering tests leak mounted components into later tests in the same file.
Individual files work around it with explicit `cleanup()`;
`console/chrome/useChromeFade.test.tsx` was identified as the one rendering file with no
such workaround, so it is the file whose behaviour this change actually alters.

**Do:** add `globals: true` to the `test` block, with a short comment saying why (RTL
auto-cleanup, and the leak it prevents).

**Do not:** remove any existing explicit `cleanup()` call. `cleanup()` is idempotent and
those files stay correct if this config is ever reverted. Do not add
`vitest/globals` to `tsconfig`'s `types` — every test file imports its helpers from
`vitest` explicitly, so no ambient types are needed. Confirm that claim with a grep before
concluding it, and report if you find a counterexample.

**Verify:** full `npm test` green (376 tests / 60 files at baseline), `npm run typecheck`,
`npm run lint`. Explicitly confirm `useChromeFade.test.tsx` passes and say so.

**Report:** the before/after test counts, and any test whose behaviour changed.

---

### Task 2: App-wide ErrorBoundary

**Spec section:** 3

**Files:**

- create `app/src/shared/ErrorBoundary.tsx`
- create `app/src/shared/ErrorBoundary.test.tsx`
- create `app/src/shared/errorBoundary.css`
- edit `app/src/App.tsx` (wire it in, and its explanatory comment)

**Placement is load-bearing — read spec section 3 before writing code.** The boundary goes
**inside** `<EngineProvider>`, wrapping `<Suspense>` and `<Routes>`. A boundary above
`EngineProvider` would unmount the provider when it catches and kill the running
simulation, breaking the project's oldest invariant. Your `App.tsx` comment must state
this reason, so a future reader does not "tidy" it upward.

**Component.** A class component (React requires one for `getDerivedStateFromError`).
State `{ error: Error | null }`. `getDerivedStateFromError` stores the error;
`componentDidCatch` logs `console.error('[sentinel] uncaught render error', error, info)`
— matching the existing `[planner]` / `[coverage]` logging convention.

**No in-place reset.** Recovery is two hard document loads, per spec:

- `RELOAD` → `window.location.reload()`
- `← MODULES` → `window.location.href = import.meta.env.BASE_URL` (a real navigation,
  **not** a react-router `<Link>`, which would keep the broken tree's module state alive)

**Fallback UI.** Dark `--chrome` glass panel centred in the viewport, e& visual language.
Copy, verbatim, no em dashes:

- heading `SYSTEM FAULT`
- body `The interface hit an unrecoverable error. Reload to continue.`
- the error's `message` in a mono block. **Message only — never render the stack.**
- the two buttons above

`#ff5a5a` is permitted here (alert case). Micro-labels 9.5px/.22em uppercase. Put styles
in `errorBoundary.css` imported by the component, matching how `planner.css` /
`chrome.css` are handled; reuse `--chrome`, `--chrome-blur` and the existing tokens rather
than inventing colours.

**Tests** (`ErrorBoundary.test.tsx`, needs `@vitest-environment jsdom` — see any existing
`.test.tsx` for the pragma convention):

1. a child that throws during render → fallback is shown, the thrown message appears, and
   the child's own output does not
2. a child that does not throw → renders normally, no fallback
3. `console.error` is called with the error (spy it, and restore the spy)

Note React logs its own error output for caught boundaries; silence or tolerate it so the
test output stays readable, but do not silence your own assertion's spy.

**Do not:** add a second boundary, add retry logic, or touch `EngineProvider.tsx`.

**Verify:** `npm test`, `npm run typecheck`, `npm run lint`. Report the entry-chunk size
from `npm run build` — this component lands in the eager entry chunk and it must stay at
roughly 216.9kB.

---

### Task 3: parsePlan element-level validation

**Spec section:** 5

**Files:**

- edit `app/src/modules/planner/domain/planIo.ts`
- edit `app/src/modules/planner/domain/planIo.test.ts`

**Correct the record first.** `planIo.ts`'s existing comment claims a malformed element
"fails safely downstream". It does not. `parsePlan`'s own return path runs
`plan.aois.map((aoi) => ({ ...aoi, valid: isValidAoiGeometry(aoi.geometry) }))`, so
`{"aois":[null], …}` throws a `TypeError` **inside `parsePlan`**. On the autosave path
`loadAutosave`'s try/catch swallows it; on the `IMPORT PLAN` path there is no try/catch,
so it surfaces as an unhandled rejection. Replace that comment with what is now true.

**Validate every element before admitting the plan. Reject the whole file** — do not drop
bad elements. Silently returning a smaller plan than the customer's file contained is
worse than refusing it, because nothing tells them.

`Aoi` requires: is an object (and not null, and not an array); `id` and `name` non-empty
strings; `source` one of `drawn | kml | kmz`; `geometry` an object whose `type` is
`Polygon` or `MultiPolygon`, with a `coordinates` array whose leaf positions are arrays of
at least two finite numbers. Validate the nesting depth appropriate to the declared
`type` (Polygon: ring → position; MultiPolygon: polygon → ring → position). Do not
require closed rings — `isValidAoiGeometry` and turf already handle geometry quality; this
is a shape gate, not a geometry gate.

`PlannedDock` requires: is an object; `id`, `name` non-empty strings; `position` an array
of exactly two finite numbers, `[lon, lat]`, with `lon` in `[-180, 180]` and `lat` in
`[-90, 90]`; `dockModel` and `droneModel` non-empty strings; `environment` exactly
`'urban'` or `'rural'`; `source` one of `manual | auto`.

Check `types.ts` for the authoritative field names and unions before writing any of this
— the lists above must match the real types, and if they disagree, the types win and you
report the discrepancy.

**Do not** validate `dockModel` / `droneModel` against the catalog. The Inspector already
handles an unknown or incompatible pairing by rendering the stored value as a marked
option with an alert badge (planner Task 12); rejecting a whole plan over a model this
build has not shipped would be a worse failure than the one already handled well. Say so
in a comment.

`valid` stays ignored on input and re-derived exactly as today.

**Messages**, matching the existing uppercase style:
`PLAN CONTAINS AN INVALID AREA AT INDEX 2` / `PLAN CONTAINS AN INVALID DOCK AT INDEX 7`.

**Tests.** One rejection test per invalid shape, and they must be genuinely distinct — a
test that would pass against the pre-fix code is worthless here, so state for each which
pre-fix behaviour it catches (throw, or silent admission). Cover at minimum: the literal
`[null]` element from the follow-up; a non-object element; a missing/blank `id`; a bad
`source`; geometry with a wrong `type`; geometry whose coordinates contain a non-number;
a dock with a 3-element position; an out-of-range lat; a bad `environment`. Plus: a valid
plan with both arrays populated still parses and round-trips through
`serializePlan`/`parsePlan` unchanged.

**Verify:** `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 4: Planner LAYERS basemap control

**Spec section:** 4. **Read it fully before starting — this task's whole risk is a shared
fact drifting between two call sites, the exact shape of this project's two worst bugs.**

**Files:**

- edit `app/src/modules/console/map/basemap.ts` (extract shared appliers)
- edit `app/src/modules/console/map/useBasemap.ts` (call them; behaviour must not change)
- create `app/src/modules/planner/map/usePlannerBasemap.ts`
- create `app/src/modules/planner/map/usePlannerBasemap.test.ts`
- create `app/src/modules/planner/ui/PlannerLayersMenu.tsx`
- edit `app/src/modules/planner/ui/PlannerTopbar.tsx`
- edit `app/src/modules/planner/ui/Planner.tsx` (mount the hook inside `PlannerShell`)
- edit `app/src/modules/planner/ui/planner.css` if the menu needs anything the existing
  `pl-dropdown` / `pl-menu` / `pl-menu-item` rules do not already provide

**Step 1 — extract, do not duplicate.** Move two functions out of `useBasemap.ts` into
`basemap.ts` (which already owns `effectiveLayer`, `DARK_OVERLAY_IDS`,
`OPERATIONAL_LAYER_IDS`) and export them:

- `applyRasterVisibility(map, eff)` — the four `raster-*` visibility sets and the
  `DARK_OVERLAY_IDS` toggle
- `applyPlaceLabelTheme(map, eff)` — the `uae-places` text/halo retint

Move them **verbatim**. `useBasemap`'s observable behaviour must not change: it keeps
computing `eff` from `scene`/`layer`/`offline`, keeps stamping `data-maplayer`, keeps
calling `setOperationalLayersVisible`. Anything else is out of scope. Existing console
tests must pass unmodified — if you find yourself editing one, stop and report instead.

**Step 2 — `usePlannerBasemap(mapRef, ready)`.** Subscribes to `useAppStore`'s `layer` and
`offline` **only**. Applies on ready and on change, mirroring `useBasemap`'s structure.

The one deliberate divergence, which your comment must state explicitly: the planner
computes `eff = offline ? null : layer` and **does not consult `scene`**. `effectiveLayer`
forces `sat` while the globe scene is up; the planner has no globe, and the store's
default `scene` is `'globe'`, so a user landing on `/planner` first would otherwise get
satellite imagery no matter what they picked. The planner also does not touch
`OPERATIONAL_LAYER_IDS` — it has no sim layers.

It stamps `document.documentElement.dataset.maplayer = layer`. This is not cosmetic:
`shared/tokens.css` keys `--chrome` off `:root[data-maplayer=…]` and `planner.css` uses
`var(--chrome)` throughout, so without the stamp the planner's glass chrome is themed by
whatever the console last left on `<html>` — dark chrome over a light basemap.

Guard every map call from cleanup with `isMapUsable(map)` per the global constraints.

**Step 3 — `PlannerLayersMenu`.** Reuses the topbar's existing `pl-dropdown` / `pl-menu` /
`pl-menu-item` pattern, the same one `DRAW ▾` uses. Do **not** import the console's
`TopMenu` — it is bound to the console's `openMenu` store slice and `#topbar` ids.

Labels and order verbatim from the console's `LayersMenu`: `DARK`, `LIGHT`, `SATELLITE`,
`TERRAIN`. Active row check-marked (`role="menuitemradio"`, `aria-checked`). Picking one
calls `setLayer` and closes the menu. Reads `layer`/`setLayer` from `useAppStore` itself —
do not thread them through `PlannerTopbar`'s props.

Render it in `PlannerTopbar` immediately before `<div className="pl-spacer" />`, labelled
`LAYERS ▾`. Only one topbar dropdown may be open at a time: opening `LAYERS` closes
`DRAW`, and vice versa. Close on outside click, the same way `DRAW` already does — if that
means lifting the open-menu state into `PlannerTopbar` as a single
`openMenu: 'draw' | 'layers' | null`, do that rather than keeping two booleans that can
both be true (the same reasoning the console applies to `controlMode`).

**Step 4 — mount** `usePlannerBasemap(mapRef, ready)` in `PlannerShell` beside the other
map hooks.

**Tests** (`usePlannerBasemap.test.ts`, jsdom pragma, fake map object with spied
`setLayoutProperty` / `setPaintProperty` / `getLayer`):

1. `scene: 'globe'` + `layer: 'light'` → the **light** raster is the visible one, not
   `sat`. This is the divergence; it must fail if someone "helpfully" routes the planner
   through `effectiveLayer`.
2. exactly one `raster-*` is set visible, the other three `none`
3. `offline: true` → no raster visible
4. `data-maplayer` is stamped with the selected layer
5. changing `layer` in the store re-applies

**Verify:** `npm test`, `npm run typecheck`, `npm run lint`. State explicitly that you did
not modify any console test.

**Report:** whether `/console`'s basemap behaviour could have changed in any way, and your
evidence.

---

### Task 5: SUGGEST LAYOUT busy state

**Spec section:** 7. Depends on Task 4 (same two files).

**Files:**

- edit `app/src/modules/planner/ui/Planner.tsx`
- edit `app/src/modules/planner/ui/PlannerTopbar.tsx`
- edit `app/src/modules/planner/ui/planner.css` if a disabled-button style is missing
- edit or create the matching test (`app/src/modules/planner/ui/Planner.test.tsx`)

**Problem.** `suggestLayout` is synchronous and CPU-bound; on a large AOI it blocks for
seconds and the click looks like it did nothing.

**Chosen mechanism (yield-then-compute).** In `handleSuggestLayout`: set `busy` true,
yield to the browser so the busy state actually paints, then run the existing synchronous
work unchanged and clear `busy`.

Yield with a **double `requestAnimationFrame`**, not `setTimeout(0)`: one rAF runs before
the next paint, two guarantees the busy state has been painted. A macrotask carries no
such guarantee.

Cancel outstanding rAF handles on unmount and bail out of the compute callback if the
component unmounted, so navigating away mid-compute cannot `setState` on a dead component.

Add a comment stating plainly that the main thread still blocks during the compute, that
this makes the wait visible rather than eliminating it, and that a Web Worker is the
escalation if AOI sizes grow. Do not build the worker.

**UI.** While busy the `SUGGEST LAYOUT` button is `disabled` and reads `PLACING DOCKS`
(no ellipsis character). `PlannerTopbar` takes a new `suggestBusy: boolean` prop. Do not
disable the rest of the topbar.

**Do not** change `suggestLayout` itself, `autoPlace.ts`, or anything in `domain/`.

**Tests.** Assert the busy state is applied before the compute and cleared after — drive
the rAF deterministically (stub `requestAnimationFrame`, or use fake timers plus a
controlled rAF shim) rather than asserting on real frame timing, per the no-wall-clock
rule. A test that only checks the end state proves nothing, since the end state is
identical to today's.

**Verify:** `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 6 (controller): Landing card to ONLINE

**Spec section:** 9

`app/src/modules/landing/modules.ts`, module 02: `status: 'dev'` → `'online'`,
`statusLabel: 'IN DEVELOPMENT'` → `'ONLINE'`. `enabled` is already `true`. Check whether
any landing test pins the old values and update it if so.

The `AI CO-PLANNER` blurb stays — carried from the legacy copy the landing page was ported
from 1:1, and it describes the module's intent. Recorded in the spec so it is a decision,
not an oversight.

---

### Task 7 (controller): Full gate and browser verification

**Spec sections:** 8, 11

Run the standing gate: app `npm test`, legacy `node --test tests/*.test.js` (65),
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`. Entry chunk
stays ~216.9kB.

Browser verification via Playwright MCP against the dev server (`http://localhost:5173/…`
— **not** `/e-Sentinel/…`, which is a blank no-route-matched page in dev; check the actual
port, Vite will move to 5174/5175 if 5173 is taken):

1. **`/console` unaffected** — the basemap extraction is this branch's regression risk.
   Globe boots, ENTER THEATER, LAYERS still switches basemap and stamps `data-maplayer`.
2. **`/planner` LAYERS** — each of the four options switches the raster *and* re-themes
   the glass chrome. Verify a planner loaded **before** ever visiting the console does not
   show satellite (the `scene: 'globe'` divergence).
3. **`IMPORT AOI`** with `src/modules/planner/io/fixtures/simple.kml` → the AOI lands in
   the plan tree and draws on the map. Then feed a `.json` to `IMPORT AOI` and confirm a
   typed error alert, not a crash.
4. **`IMPORT PLAN`** — export a plan from the session, re-import the exported file, and
   confirm it round-trips with no duplicate ids and no React key warnings.
5. **`SUGGEST LAYOUT`** shows `PLACING DOCKS` and recovers.
6. **ErrorBoundary** — force a render throw (temporarily, via the browser) and confirm the
   fallback renders instead of a blank page, then confirm the sim engine survived.
7. **Landing** shows module 02 ONLINE.
8. 0 console errors throughout.

Then update `.superpowers/sdd/progress.md` with the full per-task history, merge with
`--no-ff` per project convention, and push.

## Self-Review

- Every spec section maps to a task: 3→T2, 4→T4, 5→T3, 6→T1, 7→T5, 8→T7, 9→T6.
- Task 1 is first because it changes test semantics for everything after it.
- Tasks 2 and 3 share no files and run in parallel; 4 and 5 are sequential on
  `PlannerTopbar.tsx` / `Planner.tsx`.
- The riskiest task is 4 (touches shipped console code). It is fenced to a verbatim
  extraction, forbidden from editing console tests, and gated on a browser check of
  `/console`.
