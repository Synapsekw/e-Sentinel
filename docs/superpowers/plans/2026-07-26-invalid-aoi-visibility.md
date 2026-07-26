# Invalid AOI Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a self-intersecting AOI visible on the planner map by rendering it from its bounding box, which MapLibre's GeoJSON tiler accepts where it discards the real ring.

**Architecture:** A pure `aoiBoundsPolygon` helper in `domain/geometry.ts` produces the rectangle. `aoiFeatures` — a render adapter with exactly one consumer and no path to the coverage math — substitutes it for an invalid AOI's geometry. The existing `planner-aoi-fill` red branch, dead until now, becomes live; `planner-aoi-line` gains the matching red case so the outline agrees with the wash.

**Tech Stack:** TypeScript, Vitest, MapLibre GL JS, `@turf/bbox` (already a dependency — this plan adds no dependency and must not run `npm install`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-invalid-aoi-visibility-design.md`. Base: `master` @ `e79f431`. Branch: `feature/invalid-aoi-visibility`.
- All `npm` commands run from `app/`. The repo root path contains an `&`; `app/.npmrc` pins `script-shell` to Git Bash to survive it. Never invoke `eslint`/`prettier` through `cmd.exe`.
- The pre-commit hook runs `npm run lint` + `npm run format:check` over the whole `app/` tree and **does not auto-fix**. If Prettier complains, run `npm run format` yourself and re-stage.
- Comments explain **why**, not what. A comment that no longer describes its code is treated as a defect in this codebase — two steps in this plan exist solely to correct comments this change falsifies.
- Red is reserved for brand and alerts (`PRODUCT.md`). Green means coverage in the planner. The red used here is the alert sense.
- Domain code stays reproducible: no `Math.random()`, no bare `new Date()`.
- Do not touch: `domain/coverage.ts`, `domain/plan.ts`, `io/kml.ts`, `ui/PlanTree.tsx`, `ui/Inspector.tsx`, or anything under `modules/console/`.
- Do not run `npm install`. It would prune `lint-staged`'s stale transitive tree from `package-lock.json` and mix an unrelated dependency-graph change into this diff.

---

### Task 1: `aoiBoundsPolygon`

**Files:**
- Modify: `app/src/modules/planner/domain/geometry.ts`
- Test: `app/src/modules/planner/domain/geometry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. `@turf/bbox` default export `bbox(feature)` returning `[minX, minY, maxX, maxY]`; `feature()` from `@turf/helpers`, both already used elsewhere in this codebase.
- Produces: `export function aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null` — Task 2 calls this.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/modules/planner/domain/geometry.test.ts`. The file already defines the `square` and `bowtie` fixtures at the top and already imports `isValidAoiGeometry` from `./geometry` and `type { Polygon }` from `geojson`; extend the existing import statements rather than adding new ones, and add `MultiPolygon` to the geojson type import.

```ts
describe('aoiBoundsPolygon', () => {
  it('turns a self-intersecting ring into its closed bounding rectangle', () => {
    // The bowtie spans (0,0)-(2,2). The rectangle is wound
    // counter-clockwise from the south-west corner and repeats that corner
    // to close the ring, which is what a GeoJSON Polygon requires.
    expect(aoiBoundsPolygon(bowtie)).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    })
  })

  it('spans every part of a MultiPolygon, not just the first', () => {
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [square.coordinates, [[[55, 25], [56, 25], [56, 26], [55, 26], [55, 25]]]],
    }
    // square is (54.5,24.2)-(54.7,24.4); the second part reaches (56,26).
    // Reading only the first part would give a maximum of 54.7/24.4.
    expect(aoiBoundsPolygon(multi)?.coordinates[0][2]).toEqual([56, 26])
  })

  it('returns null for a ring collapsed to a line, which no box could show', () => {
    // Zero height: every point sits on latitude 24.2. A zero-area polygon
    // paints nothing, so emitting one would claim a fix that isn't there.
    const flat: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.6, 24.2],
          [54.5, 24.2],
        ],
      ],
    }
    expect(aoiBoundsPolygon(flat)).toBeNull()
  })

  it('returns null instead of throwing on a geometry turf cannot parse', () => {
    // Same cast-past-the-type technique the isValidAoiGeometry tests above
    // use, and for the same reason: a hand-edited or corrupted import can
    // produce a shape no caller could build through this module's types.
    const malformed = { type: 'Polygon', coordinates: null } as unknown as Polygon
    expect(() => aoiBoundsPolygon(malformed)).not.toThrow()
    expect(aoiBoundsPolygon(malformed)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `app/`: `npm run test -- geometry.test.ts`
Expected: FAIL — `aoiBoundsPolygon is not a function` (or a TypeScript "no exported member" error).

- [ ] **Step 3: Write the implementation**

In `app/src/modules/planner/domain/geometry.ts`, add `import bbox from '@turf/bbox'` to the existing imports, add `MultiPolygon` alongside `Polygon` in the existing geojson type import if not already present, and append:

```ts
// A self-intersecting ring is not just excluded from coverage -- MapLibre's
// GeoJSON tiler drops it outright, so planner-aoi-fill and planner-aoi-line
// receive no feature and the area is INVISIBLE on the map. The user draws a
// shape and nothing appears where they drew it.
//
// The tiler does accept an axis-aligned rectangle, so an invalid area is
// rendered from this stand-in instead (see map/plannerStyle.ts's
// aoiFeatures). A bounding box rather than a convex hull on purpose: a hull
// hugs the drawn points closely enough to look like a plausible AOI, which
// risks reading as the polygon that actually got committed. A rectangle
// plainly is not what anyone drew, which is the honest signal for an error
// state.
export function aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null {
  let minX: number, minY: number, maxX: number, maxY: number
  try {
    ;[minX, minY, maxX, maxY] = bbox(feature(geometry))
  } catch (err) {
    // Folded into null rather than thrown, matching isValidAoiGeometry
    // above: a caller building a render feature is not expecting an
    // exception from a geometry it already knows is bad.
    console.error('[planner] bbox() threw while bounding an invalid AOI, rendering nothing', err)
    return null
  }
  // A zero-width or zero-height box paints nothing anyway, so returning one
  // would claim a fix that isn't there. null means "no renderable stand-in
  // exists"; the area keeps its INVALID badge in the plan tree either way.
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
  if (minX === maxX || minY === maxY) return null
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `app/`: `npm run test -- geometry.test.ts`
Expected: PASS — 7 tests (3 existing `isValidAoiGeometry` + 4 new).

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/planner/domain/geometry.ts app/src/modules/planner/domain/geometry.test.ts
git commit -m "feat(planner): bound an invalid AOI with a rectangle the tiler accepts"
```

---

### Task 2: Substitute the box in `aoiFeatures`, and turn the outline red

**Files:**
- Modify: `app/src/modules/planner/map/plannerStyle.ts` (`aoiFeatures` at :26, the `AOI_VALID` comment at :19-23, the `planner-aoi-fill` comment at :86-113, `planner-aoi-line` at :175-180)
- Test: `app/src/modules/planner/map/plannerStyle.test.ts`

**Interfaces:**
- Consumes: `aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null` from Task 1.
- Produces: nothing new. `aoiFeatures`'s exported signature is unchanged; only the geometry it emits for `valid: false` AOIs differs.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('feature builders', ...)` block in `app/src/modules/planner/map/plannerStyle.test.ts`. The file already imports `aoiFeatures`, `buildPlannerStyle`, `createPlan`, `addAoi`, and `type { Aoi }`, and already defines a valid `aoi` fixture named `BOX` with id `a1`. `addAoi` stores the AOI verbatim and does not recompute `valid`, so a fixture may set `valid: false` directly.

```ts
// A bowtie: the edges (54.5,24.2)->(54.7,24.4) and (54.7,24.2)->(54.5,24.4)
// cross, which is the shape MapLibre's tiler discards.
const invalidAoi: Aoi = {
  id: 'a2',
  name: 'BOWTIE',
  source: 'drawn',
  valid: false,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.4],
        [54.7, 24.2],
        [54.5, 24.4],
        [54.5, 24.2],
      ],
    ],
  },
}

it('passes a valid AOI through with its own geometry untouched', () => {
  // Guards the branch, not the rendering: substituting on the wrong side of
  // the valid test would still produce a drawable polygon, so no assertion
  // about the invalid case would catch it.
  const fc = aoiFeatures(addAoi(createPlan(), aoi))
  expect(fc.features[0].geometry).toEqual(aoi.geometry)
})

it('renders an invalid AOI from its bounding box, which the tiler accepts', () => {
  const fc = aoiFeatures(addAoi(createPlan(), invalidAoi))
  expect(fc.features).toHaveLength(1)
  expect(fc.features[0].geometry).toEqual({
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.2],
        [54.7, 24.4],
        [54.5, 24.4],
        [54.5, 24.2],
      ],
    ],
  })
  // The paint expressions and the selection hit-test both key off these.
  expect(fc.features[0].properties?.valid).toBe(false)
  expect(fc.features[0].properties?.id).toBe('a2')
  expect(fc.features[0].properties?.name).toBe('BOWTIE')
})

it('drops an unboundable AOI without losing its valid siblings', () => {
  const flat: Aoi = {
    ...invalidAoi,
    id: 'a3',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.6, 24.2],
          [54.5, 24.2],
        ],
      ],
    },
  }
  const fc = aoiFeatures(addAoi(addAoi(createPlan(), aoi), flat))
  expect(fc.features).toHaveLength(1)
  expect(fc.features[0].properties?.id).toBe('a1')
})
```

And append to the `describe('buildPlannerStyle', ...)` block:

```ts
it('outlines an invalid AOI in alert red, matching its fill', () => {
  const layers = buildPlannerStyle().layers
  const line = layers.find((l) => l.id === 'planner-aoi-line')
  const fill = layers.find((l) => l.id === 'planner-aoi-fill')
  const valid = ['==', ['get', 'valid'], true]
  expect(line?.type).toBe('line')
  // Same condition and same red as the fill, so outline and wash cannot
  // drift apart.
  expect((line as { paint: Record<string, unknown> }).paint['line-color']).toEqual([
    'case',
    valid,
    '#e8ecf3',
    '#ff5a5a',
  ])
  expect((fill as { paint: Record<string, unknown> }).paint['fill-color']).toEqual([
    'case',
    valid,
    '#e8ecf3',
    '#ff5a5a',
  ])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `app/`: `npm run test -- plannerStyle.test.ts`
Expected: FAIL — 3 failures. The bounding-box test reports the raw bowtie coordinates instead of the rectangle; the drop test reports 2 features; the outline test reports the bare string `'#e8ecf3'` for `line-color`.

- [ ] **Step 3: Substitute the box in `aoiFeatures`**

In `app/src/modules/planner/map/plannerStyle.ts`, add `aoiBoundsPolygon` to the existing `../domain/...` imports (`import { aoiBoundsPolygon } from '../domain/geometry'`) and replace `aoiFeatures`:

```ts
export function aoiFeatures(plan: DeploymentPlan): FeatureCollection {
  return featureCollection(
    plan.aois
      // A self-intersecting ring is dropped by MapLibre's GeoJSON tiler, so
      // handing one straight through paints nothing at all -- fill, outline
      // and the selection hit-test alike. Invalid areas are rendered from a
      // bounding rectangle the tiler will keep; see aoiBoundsPolygon. The
      // `valid` property still rides along, so planner-aoi-fill and
      // planner-aoi-line tint the stand-in as the alert it is.
      //
      // Substituting HERE, and not in the store, keeps the plan's real
      // geometry intact for computeCoverage, export and the area readout:
      // this function is a render adapter, and usePlannerLayers is its only
      // consumer.
      .map((a) => ({ a, geometry: a.valid ? a.geometry : aoiBoundsPolygon(a.geometry) }))
      // A geometry too degenerate even to bound (a ring collapsed to a line)
      // has no drawable stand-in; it keeps its INVALID badge in the plan
      // tree, which is the only place it could ever have been visible.
      .filter((x): x is { a: Aoi; geometry: Polygon | MultiPolygon } => x.geometry !== null)
      // turf's featureCollection() wants a single concrete Feature<G> element
      // type; the array literal built from a.geometry's Polygon|MultiPolygon
      // union does not narrow to that on its own, so this recast is type-only.
      .map(({ a, geometry }) =>
        feature(geometry, { id: a.id, name: a.name, valid: a.valid }),
      ) as Feature<Polygon | MultiPolygon>[],
  )
}
```

Add `Aoi` to the existing `import type { DeploymentPlan } from '../domain/types'` line.

- [ ] **Step 4: Turn the outline red and correct the two falsified comments**

Still in `plannerStyle.ts`.

First, `planner-aoi-line` (currently at :175-180) gains the case, keeping `line-width` and `line-dasharray` as they are:

```ts
      // Red for an invalid area, matching planner-aoi-fill's wash, so the
      // two cannot drift apart. line-dasharray is not data-driven in
      // MapLibre, so the dash is shared and colour alone carries the
      // distinction.
      {
        id: 'planner-aoi-line',
        type: 'line',
        source: PLANNER_SOURCES.aoi,
        paint: {
          'line-color': ['case', AOI_VALID, '#e8ecf3', '#ff5a5a'],
          'line-width': 1.5,
          'line-dasharray': [2, 1],
        },
      },
```

Second, `AOI_VALID`'s comment (at :19-23) names its consumers and now has a third. Replace the first sentence:

```ts
// Shared by planner-aoi-fill's fill-color and fill-opacity and by
// planner-aoi-line's line-color: all three need the exact same "is this AOI
// valid" test, and spelling it out three times would let a future edit to
// one silently diverge from the others. See the comment on planner-aoi-fill
// for why it's ['==', ['get','valid'], true] rather than the bare
// ['get','valid'].
```

Third, `planner-aoi-fill`'s comment (at :86-113) currently states that the red branch is dead and that an invalid AOI is invisible. That is now false. Replace the paragraph running from "Neutral steel matching planner-aoi-line" through "...so they show up at all." with:

```ts
      // Neutral steel matching planner-aoi-line, so outline and fill read as
      // one object. Not green (that means coverage here) and not red (brand +
      // alerts only, per PRODUCT.md) -- except for an INVALID ring, which
      // computeCoverage excludes from the result entirely, and which is
      // therefore exactly the alert case.
      //
      // This branch used to be unreachable: MapLibre's GeoJSON tiler drops a
      // self-intersecting ring outright, so an invalid AOI painted neither
      // fill nor outline and was simply absent from the map. aoiFeatures now
      // substitutes a bounding rectangle the tiler keeps, so the tint below
      // is what the user actually sees for a broken area.
      //
      // The opacity is deliberately higher than the valid case: it has to
      // read as an alert, and it is competing with a rectangle rather than
      // the drawn shape.
```

Leave the `['==', ['get','valid'], true]` type-checker paragraph that follows it exactly as it is — it is still true and still the reason the expression is spelled that way.

- [ ] **Step 5: Run the tests to verify they pass**

Run from `app/`: `npm run test -- plannerStyle.test.ts`
Expected: PASS — all tests in the file, including the 4 new ones.

- [ ] **Step 6: Run the full app suite for regressions**

Run from `app/`: `npm run test`
Expected: PASS — 476 tests across 66 files (472 before this branch, +4 from Task 1's tests... the exact total is whatever 472 plus the tests these two tasks added comes to; what matters is **zero failures**, and in particular that `usePlannerLayers.test.ts`, `usePlannerSelection.test.ts` and `planner.integration.test.ts` are all still green).

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/planner/map/plannerStyle.ts app/src/modules/planner/map/plannerStyle.test.ts
git commit -m "feat(planner): make an invalid AOI visible instead of silently absent"
```

---

### Task 3: Full gate and browser verification

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append this branch's ledger entry; remove the now-closed invalid-AOI item from the DEFERRED / LOGGED FOLLOW-UPS list at the end)

**Interfaces:**
- Consumes: the working tree from Tasks 1 and 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Run the whole gate**

From `app/`:

```bash
npm run test && npm run typecheck && npm run lint && npm run format:check && npm run build
```

From the repo root — note the explicit glob, because bare `node --test` also sweeps `app/src`'s TypeScript tests and reports false failures:

```bash
node --test tests/*.test.js
```

Expected: app suite green, legacy 65/65, typecheck silent, lint clean at `--max-warnings 0`, `format:check` reporting all files styled, build OK. If Prettier objects, run `npm run format`, re-stage and amend — the pre-commit hook does not auto-fix.

- [ ] **Step 2: Start or reuse the dev server**

A dev server may already be running on port 5173 from a prior session, in which case `preview_start` refuses the port — just navigate to `http://localhost:5173/planner`.

Use the **Playwright MCP** tools, not the Claude Browser pane: the pane does not composite while hidden, so MapLibre's `load` event never fires, `PlannerShell` (rendered only when `ready`) never mounts, and you see a bare map with no chrome.

- [ ] **Step 3: Seed a plan with one valid and one invalid AOI**

`parsePlan` recomputes `valid` from the geometry, so setting `valid: false` in the seed does nothing — the seed must be a genuinely self-intersecting ring. Re-seeding also matters because an earlier session's drag test moved docks, so any hardcoded pixel coordinate can silently hit the wrong feature.

Write to `localStorage` under `planner.autosave.v1`, then reload:

```js
localStorage.setItem('planner.autosave.v1', JSON.stringify({
  version: 1,
  aois: [
    { id: 'ok', name: 'GOOD BOX', source: 'drawn', valid: true, geometry: { type: 'Polygon', coordinates: [[[54.30,24.40],[54.45,24.40],[54.45,24.52],[54.30,24.52],[54.30,24.40]]] } },
    { id: 'bad', name: 'BOWTIE', source: 'drawn', valid: false, geometry: { type: 'Polygon', coordinates: [[[54.55,24.40],[54.70,24.52],[54.70,24.40],[54.55,24.52],[54.55,24.40]]] } },
  ],
  docks: [],
  params: null,
}))
```

Match the exact autosave envelope the store actually writes — read it back from a live session first (`JSON.parse(localStorage.getItem('planner.autosave.v1'))`) and edit the `aois` array of that real object rather than hand-building the wrapper from this snippet, which is illustrative about the geometry, not about the envelope.

- [ ] **Step 4: Confirm the tiler now keeps both areas**

Reach the MapLibre instance by walking the React fiber from `document.getElementById('map')` up through `f.memoizedState` hook chains for a ref whose `.current` has `getLayer`/`getStyle` (the ledger has a working snippet). Then:

```js
await map.once('idle')            // querySourceFeatures reads painted tiles
map.querySourceFeatures('planner-aoi').map(f => f.properties.name)
```

Expected: **both** `GOOD BOX` and `BOWTIE`. Before this change the same probe returned only `GOOD BOX` — that is the whole bug.

- [ ] **Step 5: Confirm the paint and judge the opacity**

Screenshot the map. Expected: the valid area in neutral steel with a dashed steel outline; the bowtie's region washed red with a red dashed outline.

Then make the judgement the spec defers to this step: `fill-opacity` 0.14 was tuned against a drawn polygon, and a bounding box is by construction at least as large. If the red reads too loud at box scale, lower the invalid branch of `planner-aoi-fill`'s `fill-opacity` and re-check. Record the value chosen and the reason.

- [ ] **Step 6: Confirm the invalid area is now selectable**

Click inside the bowtie's bounding box, away from the valid area and away from any dock. Expected: the inspector opens on `BOWTIE` showing its invalid banner. Before this change no click could ever select it, because `usePlannerSelection` hit-tests `planner-aoi-fill` and that layer painted nothing for it.

- [ ] **Step 7: Confirm nothing regressed for valid areas**

Click inside `GOOD BOX`: it selects, and its outline goes white and solid (`planner-aoi-line-hi`) rather than red. Click bare map: selection clears.

- [ ] **Step 8: Record the results and commit**

Append the branch entry to `.superpowers/sdd/progress.md` — tasks, the gate numbers, and the measured browser results from Steps 4-7 including the opacity decision. Remove the invalid-AOI line from the DEFERRED / LOGGED FOLLOW-UPS list, since this branch closes it.

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: record the invalid-AOI visibility branch and its verification"
```

---

## Self-Review

**Spec coverage.** Section 2's four scoped items map to: (1) Task 1, (2) Task 2 Step 3, (3) Task 2 Step 4, (4) Task 2 Step 4. Section 5's `null` conditions are all four asserted in Task 1 Step 1. Section 6's property preservation is asserted in Task 2 Step 1. Section 7's three comment corrections — `planner-aoi-fill`, `AOI_VALID`, and the new `planner-aoi-line` — are all in Task 2 Step 4; the spec did not name the `AOI_VALID` one until it was amended, and it is covered. Section 8's two consequences are Task 3 Steps 5 and 6. Section 9's browser plan is Task 3 Steps 3-7.

**Type consistency.** `aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null` is defined in Task 1 and called with that exact signature in Task 2. `AOI_VALID` is referenced in Task 2 as the existing constant at `plannerStyle.ts:24`, not redefined. The test fixtures reuse the `Aoi` type and the file's existing `aoi`/`square`/`bowtie` fixtures rather than shadowing them.

**Known soft spot.** Task 2 Step 6's expected test total is stated as a range rather than a number, because the exact count depends on how the two test files' additions land. The pass criterion is zero failures, which is unambiguous.
