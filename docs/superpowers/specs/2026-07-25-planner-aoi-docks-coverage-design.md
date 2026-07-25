# Deployment Planner — AOI, Dock Placement & Coverage

**Date:** 2026-07-25
**Status:** Approved for planning
**Module:** `/planner` (module 02 on the landing page)
**Supersedes:** the planner portions of `2026-07-23-deployment-planner-design.md` (phases 2 and 3).
That document remains the record for the module's overall purpose, the AI co-planner (phase 5)
and the deployment model; where the two disagree, this one wins.

## 1. Scope

This build covers the 2026-07-23 spec's **phase 2 (AOI) and phase 3 (docks & coverage) as one
slice**. Phase 2 alone — draw a shape, save it — has no demo value; the combined slice is the
smallest thing that reads as a Deployment Planner.

**In scope**

- AOI definition: draw (polygon / rectangle / circle) and import (KML / KMZ).
- Manual dock placement, drag to move, per-dock inspector.
- Dock/drone catalog with a derived, overridable operational radius.
- Live coverage engine: coverage %, overlap %, uncovered gaps.
- Deterministic auto-placement (`SUGGEST LAYOUT`).
- Plan JSON export/import, localStorage autosave.

**Out of scope (later slices)**

- Mission assignments, utilization checks, KMZ export (2026-07-23 spec phase 4).
- AI co-planner (phase 5). Its open questions — browser API-key handling, and a named model
  that is now outdated — are deliberately not resolved here.
- PDF proposal export. Still future work.

## 2. Decisions taken during brainstorming

| Question | Decision | Why |
|---|---|---|
| Slice size | AOI + docks + coverage together | Smallest slice that demos as a planner |
| Radius model | Catalog default, per-dock override | Credible under questioning, still editable live |
| Existing 104-dock grid | **Not** referenced; every plan is blank-slate | Simpler domain model, self-contained plans |
| Auto-placement | In, as specced (hex grid + greedy) | The thing that makes it a planner, not a drawing app |
| Drawing layer | terra-draw for AOI, console capture-pattern for docks | Buy the hard part, reuse the proven part |
| Summary placement | Bottom strip, in the console ticker's slot | Stays visible on a projector while working the map |

## 3. Dependencies

All verified available 2026-07-25:

| Package | Version | Use |
|---|---|---|
| `terra-draw` | 1.32.2 | AOI polygon/rectangle/circle drawing + vertex editing |
| `terra-draw-maplibre-gl-adapter` | 1.4.1 | MapLibre binding (terra-draw v1 split adapters into their own packages — the 2026-07-23 spec's "terra-draw (+ MapLibre adapter)" is now two installs) |
| `@turf/buffer`, `@turf/union`, `@turf/intersect`, `@turf/difference`, `@turf/area`, `@turf/bbox`, `@turf/boolean-point-in-polygon`, `@turf/simplify`, `@turf/kinks` | 7.3.5 | Coverage geometry, plus self-intersection detection (`domain/geometry.ts`, added in the final whole-branch review to close Finding 4) |
| `@tmcw/togeojson` | 7.1.2 | KML → GeoJSON |
| `fflate` | 0.8.3 | KMZ unzip |

Cherry-picked `@turf/*` packages, **not** the `@turf/turf` meta-package — the planner needs
nine functions, not the whole library.

> **Trap:** turf 7 changed `union`, `intersect` and `difference` to take a single
> `FeatureCollection` argument, not two positional features. Most examples online still show the
> v6 two-argument signature.

## 4. Architecture

`/planner` becomes a second `React.lazy` route alongside `/console`, so terra-draw and turf never
enter the 217kB entry chunk. It reuses `MapView` / `MapContext` / `mapLifecycle` unchanged,
including the `isMapUsable` rule in every effect cleanup. It does **not** consume
`EngineProvider` — the planner has no sim.

```
app/src/modules/planner/
  domain/            framework-free, pure, unit-tested
    types.ts           DeploymentPlan, Aoi, PlannedDock, CoverageParams, CoverageResult
    catalog.ts         dock/drone catalog + radius derivation
    coverage.ts        buffer -> union -> intersect AOI -> coverage %, overlap %, gaps
    autoPlace.ts       hex candidate grid + greedy selection
    geometry.ts        self-intersection validity check (@turf/kinks), shared by kml.ts and the draw-commit path
    plan.ts            plan construction and mutation, invariants
    planIo.ts          plan JSON serialize/parse, versioned
  io/
    kml.ts             KML/KMZ -> Aoi[] (togeojson + fflate)
  map/
    plannerStyle.ts    sources + layers: AOI fill/line, docks, rings, uncovered-gap fill
    usePlannerLayers.ts  imperative plan -> source.setData sync
    useAoiDraw.ts      terra-draw setup/teardown
    useDockPlacement.ts  capture-mode click/drag for docks
  ui/
    Planner.tsx        route root
    PlannerChrome.tsx  topbar + panel frame
    PlanTree.tsx       left: plan meta, AOI list, dock list, coverage params
    Inspector.tsx      right: selected AOI or dock editor
    SummaryStrip.tsx   bottom: headline numbers
  store/planStore.ts
```

**Domain stays pure.** Every coverage and placement function takes GeoJSON and returns GeoJSON or
numbers — no map, no React. This is what makes auto-placement determinism testable, and it mirrors
the discipline of `console/domain`.

**Plan state gets its own Zustand store**, not a slice of the shared app store. Nothing outside
`/planner` reads a plan and the plan mutates constantly; a separate store keeps the global store
from becoming a junk drawer while keeping the API the codebase already uses.

**The console's imperative-per-frame invariant does not apply here and should not be copied.**
The planner is event-driven, not 60fps — there is no ticker. The plan lives in React state and
panels re-render normally. Only two things are imperative: pushing plan-derived GeoJSON into map
sources, and dock dragging (the ring follows the cursor imperatively; coverage recomputes on
`dragend`). A turf union on every mousemove would visibly stutter.

## 5. Domain model

```ts
interface DeploymentPlan {
  id: string; name: string; customer: string;
  createdAt: string; updatedAt: string;
  schemaVersion: number;          // planIo migration hook
  aois: Aoi[];
  docks: PlannedDock[];
  params: CoverageParams;
  rev: number;                    // bumped on every mutation; drives layer sync + recompute
}

interface Aoi {
  id: string; name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  source: 'drawn' | 'kml' | 'kmz';
  valid: boolean;                 // false => excluded from coverage math, flagged in the list
  simplifiedFrom?: number;        // original vertex count, when simplification ran
}

interface PlannedDock {
  id: string; name: string;
  position: [lon: number, lat: number];
  dockModel: DockModelId;         // catalog key
  droneModel: DroneModelId;       // catalog key
  environment: 'urban' | 'rural';
  radiusKmOverride?: number;      // when set, wins over the derived radius
  source: 'manual' | 'auto';      // provenance, kept in exports
}

interface CoverageParams { targetOverlapPct: number; requiredCoveragePct: number; }

type CoverageResult =
  | { ok: false; reason: 'no-aoi' | 'no-docks' | 'degenerate' }
  | {
      ok: true;
      aoiKm2: number;
      coveragePct: number;
      overlapPct: number;
      uncovered: GeoJSON.MultiPolygon;
      gapCount: number;
      // grossContributionKm2 is each dock's own buffer intersected with the AOI,
      // counted on its own. Overlapping docks each report their full share of
      // shared ground, so summing this field across perDock can and routinely
      // does exceed the actual covered area (aoiKm2 * coveragePct / 100). It
      // must not be summed or presented as a share of coveragePct.
      perDock: { dockId: string; grossContributionKm2: number }[];
    };
```

`CoverageResult` is a discriminated union rather than a struct with nullable numbers, so "no AOI
yet" and "no docks yet" render as states instead of `NaN%`.

## 6. Radius model

The endurance derivation and the sim's 3 km / 5 km rule disagree, and the disagreement is the
point. Raw endurance on an M4TD allows roughly 15 km one-way; nobody plans to that, because BVLOS
and airspace rules bind first.

```
enduranceKm = cruiseKph/60 × (enduranceMin × (1 − reservePct) / 2 − onTaskMin)
radiusKm    = min(enduranceKm, environmentCapKm)     // urban 3, rural 5 — the sim's constants
```

The inspector shows both terms and which one bound. That converts the 2026-07-23 spec's weakest
open question into its strongest sales line: *"the aircraft can reach 15 km; we plan to 5 because
of BVLOS — here is the headroom."* A per-dock `radiusKmOverride` wins over both, for
site-specific constraints raised mid-meeting.

**Reuse, do not re-implement.** `console/domain/docks.ts` already exports `DOCK_RANGE` with
`URBAN_RANGE_KM` (3), `RURAL_RANGE_KM` (5), `URBAN_CENTERS` and `isUrbanDock(dock)`. The planner
imports these directly, which guarantees planner rings match console rings and gives
`environment` a sensible default: a newly dropped dock auto-detects urban/rural from its position
via `isUrbanDock`, and the inspector lets you override it. `SUGGEST LAYOUT` (`domain/autoPlace.ts`)
derives each candidate's environment from its own position the same way — see §8 — so a single run
over an AOI straddling an urban boundary produces docks at both the 3km and 5km radii, matching
whatever a manually-placed dock at the same spots would get, never one radius applied uniformly
regardless of where a candidate actually sits.

The catalog (`domain/catalog.ts`) holds dock models, the drones each can host, and per-drone
`cruiseKph` / `enduranceMin` / `reservePct` / `onTaskMin`. The sim carries no per-drone endurance
data — its `speedMs` values (8–19 m/s) are per *mission type*, not per airframe — so these
figures are genuinely new.

**Seed values are PROVISIONAL and must be labelled as such in the file.** They are drawn from
public DJI marketing figures for the three airframes the sim already uses and have not been
verified against a datasheet. The 2026-07-23 spec's open question about proposal-grade numbers
**remains open**; the catalog exists so replacing them is a one-file change.

| Drone | cruiseKph | enduranceMin | reservePct | onTaskMin | ⇒ enduranceKm | binding term |
|---|---|---|---|---|---|---|
| M4TD | 54 | 48 | 0.30 | 5 | ~12.9 | cap |
| M4D | 54 | 49 | 0.30 | 5 | ~13.2 | cap |
| M350 | 61 | 55 | 0.30 | 5 | ~17.0 | cap |

In every seeded case the environment cap binds, not endurance — which is exactly the point §6
makes, and gives the inspector a real number to show as headroom.

## 7. Coverage engine

Pure pipeline in `domain/coverage.ts`:

1. Union all valid AOIs → `aoiGeom`; `aoiKm2 = area(aoiGeom)`.
2. Buffer each dock at its effective radius, **64 steps**, so rings look circular at high zoom.
3. Union the buffers → `coverageGeom`.
4. `intersect(coverageGeom, aoiGeom)` → `covered`; `coveragePct = area(covered)/aoiKm2`.
5. `difference(aoiGeom, coverageGeom)` → `uncovered`, rendered as a translucent red fill (see
   `plannerStyle.ts`'s `planner-gaps-fill` layer; **not** hatched -- see the note there for why);
   `gapCount` = its polygon count.
6. Overlap: union of all **pairwise** buffer intersections, clipped to the AOI, over `area(covered)`.

Step 6 is deliberately the strict definition. The cheap alternative — summed dock areas minus the
union — silently counts triple-covered ground twice, and *"23% of your covered area has redundant
coverage"* has to survive a follow-up question. It is O(n²) intersects, which at realistic dock
counts is tens of milliseconds and sits behind the same debounce.

## 8. Auto-placement

`domain/autoPlace.ts`, deterministic **by construction** — no RNG, so no seed to manage:

- Each candidate's radius is derived from **its own position** via `DOCK_RANGE.isUrbanDock` (same
  model §6 describes for manual placement), not one radius for the whole run. A final review of
  this slice found `suggestLayout` originally hardcoded every generated dock's environment to
  `'rural'`, so an AOI straddling an urban boundary got uniform 5km rings where the product's own
  model says part of it should be 3km. Scoring now uses each candidate's real radius; the sample
  grid and initial candidate lattice, which each need one spacing number decided before any
  candidate position is known, are sized conservatively from `min(urbanRadiusKm, ruralRadiusKm)` —
  denser than either radius alone would require, so a tighter-radius urban pocket inside an
  otherwise-rural AOI is never under-resolved.
- Hex lattice anchored to the AOI bbox corner (never a random or centroid-derived origin).
- Spacing `minRadiusKm · √3 · (1 − targetOverlapPct)`.
- Candidates filtered to those inside the AOI via `booleanPointInPolygon`, then bounded to
  `MAX_CANDIDATES` by widening the spacing deterministically (same technique as the sample grid)
  until the count fits.
- Existing docks already in the plan (manual or auto) are preserved, never replaced: their coverage
  seeds the greedy loop's covered-set before any new candidate is scored, and the result appends new
  docks to them rather than discarding them. `MAX_DOCKS` is a total-plan budget, counting docks
  already present, not a per-run allowance.
- Greedy: repeatedly take the candidate adding the most uncovered area; stop at
  `requiredCoveragePct`, when marginal gain falls below **`MIN_MARGINAL_GAIN_SAMPLES` (2)
  still-uncovered sample-grid cells**, or at the dock cap.
- **Densify on exhaustion:** if the candidate lattice runs dry (every site has been taken) while
  coverage is still short of `requiredCoveragePct` and the dock cap has not been reached, the
  lattice is refined: spacing is halved from whatever spacing produced the current lattice (same
  bbox-minimum-corner anchor, same stable sort, re-bounded to `MAX_CANDIDATES` if needed), any site
  duplicating an already-chosen dock is dropped, and the greedy loop continues. This repeats up to
  `MAX_REFINEMENTS` times, so it always terminates.
- Stable coordinate ordering (lat then lon, ascending) as tie-break, re-applied after every
  refinement.

**Named constants** — all live in `autoPlace.ts`, all exported so tests pin them:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_DOCKS` | 40 | Hard cap; produces the `STOPPED AT n% · 40 DOCK CAP` message |
| `MIN_MARGINAL_GAIN_SAMPLES` | 2 | Below this many still-uncovered sample-grid cells, the next dock is not worth placing |
| `SAMPLE_SPACING_DIVISOR` | 4 | Sample grid spacing = `radiusKm / 4` |
| `MAX_SAMPLE_POINTS` | 20000 | Spacing widens to respect this on very large AOIs |
| `MAX_CANDIDATES` | 2000 | Candidate lattice spacing widens to respect this on very large AOIs |
| `MAX_REFINEMENTS` | 3 | Hard cap on how many times the lattice is halved to densify |

**Why the floor is a fixed sample-cell count, not a percentage of anything:** an earlier version of
this floor (`MIN_MARGINAL_GAIN_PCT`, 0.25% of *total AOI area*) was not scale-invariant. A rural
dock's own footprint (`pi · radiusKm²`, ~78.5km² at the 5km rural radius) is a fixed quantity, so
for any AOI larger than roughly 31,400km² a single dock's entire footprint already falls below
0.25% of the total area, so the greedy loop rejected its very first candidate and `suggestLayout`
silently returned zero docks with no explanation. Measured live: an 82,522km² AOI produced 0 docks,
while a 171km² AOI produced 4 docks at 96% coverage under the same code path.

The first fix re-expressed the floor as a fraction (2%) of one dock's own unobstructed footprint.
A later review did the algebra and found that framing overstated its own precision. The sample
grid's spacing (`sampleSpacingKm = radiusKm / SAMPLE_SPACING_DIVISOR`) is derived from the same
`radiusKm` as the footprint, so `radiusKm` cancels entirely out of "one dock's footprint, in sample
cells":

```
dockFootprintSamples = (pi * radiusKm^2) / (radiusKm / SAMPLE_SPACING_DIVISOR)^2 = pi * SAMPLE_SPACING_DIVISOR^2
```

At `SAMPLE_SPACING_DIVISOR = 4` that is a near-constant ~50.3 sample cells at whichever radius the
sample spacing was itself derived from, regardless of AOI size. "2% of footprint" therefore
reduced, always, to "reject a candidate whose best gain is 0 or 1 sample cell" -- a fixed rule
dressed up as a scale-sensitive percentage. The floor is now named directly in the unit the greedy
loop already scores gain in: `MIN_MARGINAL_GAIN_SAMPLES` (2) still-uncovered sample-grid cells,
used with no percentage indirection. This is still not free of `SAMPLE_SPACING_DIVISOR`: one sample
cell's ground area is `sampleSpacingKm²`, so a coarser divisor makes each cell, and so this floor's
real-world km² meaning, larger. 2 was chosen because it reproduces the pre-existing, already-
validated 20km-box fixture's quality while remaining a fixed, AOI-size-independent quantity, so a
very large AOI still places docks up to `MAX_DOCKS` instead of zero. (The fixture's own docks/
coverage numbers moved from 11 docks / 97.63% to 20 docks / 94.34% once §8's per-position
environment fix landed — this box straddles the edge of Abu Dhabi's urban circle, so roughly half
its docks now get the tighter 3km cap instead of the old uniform 5km; the quality bar the constant
was chosen against is "reaches the required coverage without an unreasonable dock count," which
still holds.)

**Perf:** the greedy loop scores marginal gain on a **rasterized sample grid**, not exact polygon
operations — hundreds of exact unions in a loop would hang the tab. One exact coverage computation
runs at the end over the chosen set. Because both the sample grid and the candidate lattice are
derived deterministically from the AOI bbox and radius, widening either's spacing to respect its
`MAX_*_POINTS`/`MAX_CANDIDATES` bound does not break reproducibility. Without a candidate bound,
a large but plausible AOI (a few hundred km across at a small dock radius) could push the candidate
count into the thousands, and the greedy loop's `O(docks × candidates × samples)` cost would defeat
the entire reason sampling was chosen over exact polygon ops; `MAX_CANDIDATES` keeps that bounded
the same way `MAX_SAMPLE_POINTS` already bounds the sample side.

Results are ordinary `PlannedDock`s with `source: 'auto'` and are fully editable afterwards.
Partial outcomes are reported honestly via `stoppedBy`, one of four values:

| `stoppedBy` | Meaning |
|---|---|
| `'target'` | Reached `requiredCoveragePct` |
| `'cap'` | Hit `MAX_DOCKS` before reaching target |
| `'gain'` | The best remaining candidate's marginal gain fell below `MIN_MARGINAL_GAIN_SAMPLES` still-uncovered sample cells, with candidates still on the table: it genuinely was not worth placing another dock |
| `'exhausted'` | No candidate sites remain, even after `MAX_REFINEMENTS` rounds of densification |

`'gain'` and `'exhausted'` are deliberately distinct: the former means the next dock was not worth
it, the latter means there was no next dock to consider. Conflating them (as an earlier version of
this code did, reporting `'gain'` whenever the coarse lattice ran out) reads as "further docks
would not have helped," which is false when densification would have found more useful sites.
Reported as e.g. `STOPPED AT 78% · 40 DOCK CAP`.

## 9. Data flow

```
user action ──> planStore mutation (rev++)
                  ├─> panels re-render (normal React)
                  ├─> usePlannerLayers effect: plan -> GeoJSON -> source.setData
                  │     (guarded by isMapUsable + the MapView ready latch)
                  └─> debounced 150ms coverage job -> CoverageResult -> store
                        └─> summary strip + uncovered-gap fill layer
```

The coverage job carries a revision guard: if `rev` changes while a computation is in flight, the
stale result is discarded rather than written. Dock dragging bypasses the chain entirely — the
ring follows the cursor imperatively and only `dragend` commits.

Both `usePlannerLayers` and the debounced coverage job key their effects off `plan.aois`,
`plan.docks` and `plan.params` specifically, not off the plan object's identity. `domain/plan.ts`'s
`bump()` always carries a mutation's untouched fields through by reference, so a cosmetic-only edit
(the plan name or customer field, typed in `PlanTree.tsx`) produces a new `plan` object but the
exact same `aois`/`docks`/`params` references — neither the map sync nor a `computeCoverage` run is
triggered by typing a name. A final review of this slice found both hooks originally depended on
`plan` itself, so every keystroke in a name field rebuilt every dock ring buffer and, after the
debounce, re-ran the full coverage pipeline with no geometry having changed at all.

Persistence: debounced localStorage autosave for convenience; plan JSON export/import is the
source of truth.

## 10. Screen layout

Mirrors the console chrome, reusing its CSS tokens and the 9.5px / .22em uppercase mono
micro-label idiom, so the two modules read as one product.

- **Topbar** — e& logo, `DEPLOYMENT PLANNER`, then `IMPORT AOI` · `DRAW ▾` (polygon /
  rectangle / circle) · `+ DOCK` · `SUGGEST LAYOUT` · `LAYERS ▾`, and a link back to modules.
- **Left panel** — plan name and customer, AOI list with km² per shape, dock list, and a
  coverage-params tile holding the target-overlap and required-coverage sliders that drive
  `SUGGEST LAYOUT`.
- **Right panel** — inspector for the current selection: AOI name and area, or dock name, model,
  drone, environment, and the radius with its derivation and binding term spelled out.
- **Bottom strip** (the console ticker's slot) —
  `COVERAGE 87% · OVERLAP 23% · DOCKS 6 · GAPS 2 · AOI 412 km²`.

UI copy follows the existing rules: no em dashes, mono micro-labels, red `#ff5a5a` / `#BC0000`
reserved for brand and alerts (an uncovered-gap warning qualifies; a dock marker does not).

## 11. Error handling

Nothing throws into React; nothing degrades silently.

- **Import** returns a typed result union: `UNREADABLE` (not a zip / corrupt), `NO_KML` (KMZ with
  no `.kml` entry), `BAD_XML`, `NO_AREAS` (parsed but contained only points/lines, reported as
  *"3 placemarks, 0 areas"*). Partial successes report their arithmetic:
  `2 AREAS IMPORTED · 5 FEATURES SKIPPED`.
- **Oversized geometry** is simplified above **1500 vertices per AOI** (`SIMPLIFY_VERTEX_THRESHOLD`)
  using `@turf/simplify` at tolerance **0.0001°** with `highQuality: false`, and the UI says so —
  `SIMPLIFIED · 4812 → 1200 VERTICES`, with the original count kept in `Aoi.simplifiedFrom`. The
  simplified geometry is what gets stored, drawn *and* measured, so the number on screen always
  describes the shape on screen. A coverage number quietly computed against a different shape than
  the one displayed is the worst failure available here.
- **Degenerate geometry** (empty union, null intersect, or a thrown error from the turf pipeline
  itself) lands in `CoverageResult.ok === false, reason: 'degenerate'`. `computeCoverage` wraps the
  whole geometry pipeline in a try/catch precisely because malformed KML can make turf throw
  instead of returning null.
- **Self-intersecting rings** are validated on commit — terra-draw guards live drawing, but
  imported KML can arrive self-intersecting. An invalid AOI is excluded from the math and flagged
  in the list rather than poisoning the total.
- **Auto-placement** carries a hard dock cap and reports partial outcomes rather than looping.
- **Map teardown** uses `isMapUsable` in every cleanup, and terra-draw's own teardown must run
  before `map.remove()`.

## 12. Testing

Domain first, against fixtures a human can verify by hand:

- One dock centred in a square AOI → arithmetically known coverage %.
- Two circles at a known separation → lens area from the closed-form formula.
- Auto-placement run twice on identical input → byte-identical output, plus a golden fixture.
- Catalog derivation including the `min()` cap and which term bound.
- Plan JSON round-trip including `schemaVersion`.
- KML and KMZ parsing against small committed fixture files, one per error branch.

Then panel component tests over a fake plan (including every import error state), and an
integration test asserting the map sources receive the correct feature counts — the console
already has this pattern. Browser verification via Playwright MCP at the end: import a real KML,
draw, place, suggest layout, screenshot.

## 13. Risks

- **terra-draw ↔ `mapLifecycle` teardown seam.** This is the same class of bug as the parent-first
  teardown crash fixed in Phase 1F. **Task one must be a thin spike** that mounts the planner,
  draws, routes away and returns with zero console errors, before anything is built on top.
- **terra-draw default styling** is generic and needs restyling to brand tokens.
- **Turf on emirate-scale MultiPolygons** — mitigated by the vertex-threshold simplification in §11
  and the sample-grid scoring in §8. A web worker is the escape hatch if those prove insufficient;
  deliberately not in this slice.
- **Catalog figures are seeded, not proposal-grade.** Carried forward unresolved from the
  2026-07-23 spec §10. Structured as a one-file change.
