# Invalid AOI Visibility — Design

Date: 2026-07-26
Status: approved (user reviewed the design in-session and directed "write the spec and plan
and then execute it without asking me any questions")
Base: `master` @ `e79f431`

## 1. Purpose

An AOI whose ring self-intersects is **invisible on the map**. Not tinted, not outlined —
absent. MapLibre's GeoJSON tiler discards a self-intersecting ring outright, so neither
`planner-aoi-fill` nor `planner-aoi-line` receives a feature to paint. The user draws or
imports a shape and nothing appears where they drew it.

This was found during browser verification of the planner/simulation polish branch and
recorded as a follow-up rather than smuggled into that pass. The polish branch's spec
(`2026-07-26-planner-simulation-polish-design.md`, section 5) carries the correction and
the reasoning; commit `8fb0be9` was the correction to that spec, `772cc84` the matching
correction to `plannerStyle.ts`'s comment.

The fix: render an invalid area from a stand-in geometry the tiler accepts.

## 2. Scope

In scope:

1. A pure `aoiBoundsPolygon` helper producing an AOI's axis-aligned bounding rectangle.
2. `aoiFeatures` substituting that rectangle for an invalid AOI's unrenderable ring.
3. `planner-aoi-line` turning red for an invalid area, matching the fill.
4. Correcting `planner-aoi-fill`'s comment, which currently documents the opposite of
   what the code will do.

Out of scope: the coverage algorithm, `parsePlan`, KML import, the `valid` flag itself and
where it is set (`domain/geometry.ts`'s `isValidAoiGeometry`, already correct), the
`INVALID GEOMETRY` badge in `PlanTree.tsx` / `Inspector.tsx` (already correct), and
`/console`.

Explicitly **not** this bug, though it looks adjacent: the polish branch's Minor finding
that a coverage result of `{ ok: false, reason: 'degenerate' }` paints no gap red at all,
reachable by dragging the radius slider to its `min=0`. That is a coverage-result
invisibility, not a geometry-tiling one, and it is unaffected by anything here.

## 3. Why the substitution belongs in `aoiFeatures`

`aoiFeatures` (`map/plannerStyle.ts:26`) is a render adapter. Its entire job is turning a
plan into what the map draws, and it has exactly one runtime consumer —
`usePlannerLayers.ts:31`, feeding `PLANNER_SOURCES.aoi`. Coverage math never touches it;
`computeCoverage` reads `plan.aois` directly (`domain/coverage.ts:34`). So substituting a
renderable stand-in inside `aoiFeatures` is that function discharging its stated
responsibility, and it is structurally incapable of affecting the simulation.

Everything downstream then works unchanged — `planner-aoi-fill`, `planner-aoi-line`,
`planner-aoi-line-hi`, and `usePlannerSelection`'s hit-test. None of those were broken.
They were being handed geometry the tiler threw away.

The alternative considered and rejected was a separate `planner-aoi-invalid` source with
its own fill and line layers, which keeps `aoiFeatures` geometrically truthful. It needs a
third highlight layer for selection, a second `setData` to hold in sync, and new precedence
rules in `usePlannerSelection` — appreciably more machinery for identical pixels.

## 4. Why a bounding box and not a convex hull

A convex hull hugs the drawn points far more closely: a bowtie's hull is its outer
quadrilateral, which is nearly what the user drew. That is precisely the argument against
it here. A hull **looks like a plausible AOI**, so it risks the user believing that is the
polygon that got committed. A rectangle obviously is not what anyone drew; it reads as
"the region occupied by a broken shape". For an error state whose whole job is to say
something is wrong, the cruder shape carries the better signal.

The bounding box is also free: `@turf/bbox` is already a dependency, so no `npm install`
and therefore no lockfile churn in this diff. (Which matters slightly: the lockfile still
carries `lint-staged`'s transitive tree, and an install here would prune it, mixing an
unrelated dependency-graph change into this commit.)

If the box reads too coarse in the browser, a hull is a drop-in replacement for
`aoiBoundsPolygon`'s body plus one dependency — this design does not foreclose it.

## 5. `aoiBoundsPolygon`

Lives in `domain/geometry.ts`, beside its sibling `isValidAoiGeometry`. That file is the
AOI-geometry module; this is a pure, deterministic geometry function with its own unit
tests, and keeping it there leaves `plannerStyle.ts` about style.

```ts
export function aoiBoundsPolygon(geometry: Polygon | MultiPolygon): Polygon | null
```

Returns the closed five-point rectangle `[minX,minY] → [maxX,minY] → [maxX,maxY] →
[minX,maxY] → [minX,minY]`.

Returns `null` when the box has zero width or zero height (a ring collapsed to a line or a
point), when any bound is non-finite, or when turf throws. A zero-area polygon paints
nothing regardless, so emitting one would be a lie about having fixed anything; `null` says
"no renderable stand-in exists" and the caller drops the feature — which is exactly today's
behaviour for that case. The throw path mirrors `isValidAoiGeometry`, which folds a turf
throw into `false` rather than letting it reach a caller that is not expecting one.

Such an AOI keeps its `INVALID GEOMETRY` badge in the plan tree, so it is never silently
lost from the plan — only from the map, where nothing could be drawn for it anyway.

## 6. `aoiFeatures`

For `!aoi.valid`, emit `aoiBoundsPolygon(a.geometry)` in place of `a.geometry`; drop the
feature if that is `null`. Properties (`id`, `name`, `valid`) are unchanged, so the `valid`
flag still drives the paint expressions and the feature is still selectable by id.

## 7. Paint

`planner-aoi-fill` needs **no paint change**. Its `['case', AOI_VALID, '#e8ecf3', '#ff5a5a']`
red branch has been dead code — unreachable for the invalidity that actually occurs — and
becomes live for the first time. Its comment, however, currently states at length that the
branch is dead and that an invalid AOI is invisible. After this change that is false, and
this codebase treats a comment that has drifted from its code as a defect: several findings
on the polish branch were exactly that. The comment is rewritten to describe the stand-in.

`planner-aoi-line` gains the matching case on `line-color`:

```ts
'line-color': ['case', AOI_VALID, '#e8ecf3', '#ff5a5a'],
```

so outline and wash agree. `AOI_VALID` is the shared expression constant already defined at
`plannerStyle.ts:24` for exactly this purpose — its own comment names its two consumers
("`planner-aoi-fill`'s `fill-color` and `fill-opacity`") and so needs updating to name the
third, on the same drifted-comment principle.

`line-dasharray` is **not** data-driven in MapLibre, so the dash pattern stays shared
between valid and invalid outlines; colour alone carries the distinction. Red is legitimate
here under `PRODUCT.md`'s "red is brand and alerts only" — an area excluded from coverage
by broken geometry is an alert.

`planner-aoi-line-hi` (the selection highlight) stays white and solid. Selection reads as
selection regardless of validity, matching how a selected dock is highlighted without
regard to its `source`. The red fill remains visible underneath, and the inspector's
invalid banner is unambiguous.

## 8. Two consequences, on the record

**An invalid AOI becomes clickable for the first time.** `usePlannerSelection` hit-tests
`planner-aoi-fill` (`usePlannerSelection.ts:22`). A layer that paints nothing can never be
returned by `queryRenderedFeatures`, so today an invalid area cannot be selected by map
click at all — a second symptom of this same bug, and one not previously recorded. After
this change it is selectable, over the bounding box's larger footprint. This is judged
correct (you can click what you can see) but it is a change to selection behaviour, not
purely cosmetic, and is called out here rather than left to be discovered.

**The invalid `fill-opacity` of 0.14 was tuned against a drawn polygon.** Spread over a
bounding box — which is by construction at least as large, and for a thin diagonal shape
much larger — it may read too loud. Treated as a visual judgement confirmed in the browser,
the same way the polish branch handled the original opacity values, not as an assertion.

## 9. Tests

`domain/geometry.test.ts` — for `aoiBoundsPolygon`:
- the existing `bowtie` fixture yields the closed rectangle `(0,0)`–`(2,2)`;
- a `MultiPolygon` spans all its parts, not just the first;
- a ring collapsed to a line (zero height) yields `null`;
- a malformed geometry turf cannot parse yields `null` and does not throw, reusing the
  cast-past-the-type technique the file already uses for `isValidAoiGeometry`.

`map/plannerStyle.test.ts` — for `aoiFeatures`:
- a valid AOI's coordinates come through **unchanged** (guards against substituting on the
  wrong branch, which no rendering assertion would catch);
- an invalid AOI emits the five-point rectangle, with `valid: false` and `id`/`name` intact;
- an invalid AOI with no renderable box is dropped while its valid sibling survives;
- `planner-aoi-line` carries the `line-color` case.

Browser verification, per the environment's Playwright-not-Claude-Browser rule: seed
`planner.autosave.v1` with one valid AOI and one bowtie, then after `map.once('idle')`
confirm `querySourceFeatures('planner-aoi')` returns **both** (it returns only the valid one
today), that the red wash and red outline paint, and that a click inside the box selects the
invalid area. `parsePlan` recomputes `valid` from the geometry, so the seed must be a
genuinely self-intersecting ring — setting `valid: false` in the seed does nothing.

## 10. Risks

The substitution is confined to one function with one consumer, and the coverage path reads
`plan.aois` directly, so the blast radius is the AOI source's rendered geometry and nothing
else. The realistic failure is aesthetic (a bounding box or its red too coarse to be
useful), which browser verification is positioned to catch, and which the hull option in
section 4 answers without redesign.
