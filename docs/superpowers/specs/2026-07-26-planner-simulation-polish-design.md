# Planner + Simulation Polish and Unification — Design

Date: 2026-07-26
Status: approved (design presented and approved in-session; dock naming and duplicate
AOI names folded in on explicit user request after the first approval)
Base: `master` @ `c1a613a`

## 1. Purpose

`/planner` and `/console` are two views of one product but do not read as one product.
The user reported three symptoms — no map layer selection, a transparent polygon until
the first dock lands, and no way to set a dock's coverage range in kilometres — and asked
for a matching consistency pass over the simulation.

Browser verification (1600×900, real MapLibre, live tiles) traced those three symptoms to
four distinct causes, only one of which matched the reported wording. This spec fixes the
causes, not the wording, and closes the console/planner divergences found alongside them.

## 2. What verification actually found

The planner's basemap picker **already exists and works**: clicking `LAYERS ▾` →
`SATELLITE` swaps the raster correctly. The reported symptom was discoverability — the
control is the 7th item in the tool row, after `IMPORT PLAN`, and its label never says
which basemap is active.

Per-dock radius **already exists** in the domain (`PlannedDock.radiusKmOverride`,
`catalog.ts`'s `effectiveRadius`) and in `Inspector.tsx` as a bare number input. It is
unreachable in practice because the planner has **no map-click selection at all** — the
inspector only opens from a left-panel row, and clicking a dock on the map only drags it.

The AOI fill is **genuinely absent**: `plannerStyle.ts` declares `planner-aoi-line` and no
fill layer, so a committed polygon is a dashed outline over bare map until dock coverage
rings green in its interior.

### 2.1 The bug nobody reported

`MapView` calls the console's `useBasemap` unconditionally for every consumer, including
the planner. `useBasemap`'s apply step runs:

```ts
setOperationalLayersVisible(map, useAppStore.getState().scene === 'console')
```

`OPERATIONAL_LAYER_IDS` (`console/map/basemap.ts`) includes `uae-places` and `uae-roads` —
the UAE cartography the planner needs — alongside the simulation layers it does not have.
The store's default `scene` is `'globe'`, and the planner has no scene of its own and never
corrects the flag. Measured on `/planner`:

| Arrival path | `uae-places` visibility | Labels rendered |
| --- | --- | --- |
| Cold load / direct link | `none` | 0 |
| `/console` → ENTER THEATER → `/planner` | `visible` | 9 |

A cold-loaded planner therefore has no city names and no UAE road network — dock placement
happens against an unlabelled dark shape. The faint lines still visible are CARTO's
baked-in raster roads, not `uae-roads`. The planner's cartography depends on the user's
navigation history, which is the sharpest instance of "not consistent with the simulation"
in the product.

`usePlannerBasemap` re-applies raster visibility after `useBasemap` and so happens to
correct the `effectiveLayer('globe', layer) === 'sat'` force, but nothing corrects the
operational-layer flag. The rasters being right today is an ordering coincidence, not a
guarantee.

## 3. Scope

In scope, ten items:

1. Planner map cartography — the `useBasemap`/`usePlannerBasemap` collision (§4).
2. AOI fill layer (§5).
3. Dock radius slider replacing the number input (§6).
4. Map-click selection in the planner (§7).
5. Selected entity highlighted on the planner map (§8).
6. `LAYERS` discoverability and topbar regrouping (§9).
7. Bright-basemap panel legibility (§10).
8. Planner topbar responsive drop-out (§11).
9. Unified dock naming across manual and auto placement (§12).
10. Collision-free AOI names (§12).

Out of scope, deliberately:

- The coverage and auto-placement algorithms themselves.
- `SUGGEST LAYOUT` discarding manually placed docks (`setDocks` replaces the whole array).
  Real, arguably wrong, but a behaviour change rather than a consistency fix. Recorded
  here so it is not lost.
- The provisional drone catalog figures in `catalog.ts`.
- Modules 03/04 and the Higgsfield videos.
- Any change to simulation behaviour. The user scoped the simulation half to
  "only what unifies the two", so console-owned code takes exactly two changes, both in
  §9 and both behaviour-preserving: the `LAYER_LABELS`/`LAYER_ORDER` de-duplication, and
  an optional `className` prop on `OfflineChip` whose default reproduces today's markup.
  A third, `useBasemap`'s new `enabled` parameter (§4), defaults to `true` and so leaves
  the console's call site unchanged. Items 9 and 10 (§12) are planner-domain only.

## 4. Item 1 — Planner map cartography

### Approach

`useBasemap` gains a third parameter, `enabled = true`, and early-returns when it is
false. `MapView` gains `manageBasemap?: boolean`, also defaulting to `true`, and forwards
it as that parameter. `Planner` passes `false`.

The flag is a hook *parameter* rather than a condition around the call: React forbids
conditional hook calls, and `react-hooks/rules-of-hooks` would reject the alternative.

```tsx
<MapView
  initialCenter={PLANNER_CENTER}
  initialZoom={PLANNER_ZOOM}
  styleSpec={buildPlannerStyle()}
  manageBasemap={false}
>
```

`useOffline` still runs unconditionally — offline fallback is map-lifecycle behaviour that
both routes want.

With `useBasemap` out of the picture, `uae-places` and `uae-roads` keep their style
defaults (visible) and `usePlannerBasemap` is the single writer of the planner's basemap
state. No layer has two writers.

### Why not the alternatives

Having `usePlannerBasemap` call `setOperationalLayersVisible(map, true)` after the fact
would work by ordering, which is exactly the property that produced the bug. Two hooks
writing the same layers in a load-order-dependent sequence is the defect, not the fix.

Splitting `OPERATIONAL_LAYER_IDS` into simulation layers and cartography layers is a
defensible refactor, but it changes a list the console's globe scene depends on to fix a
problem the planner has, and it still leaves `useBasemap` running against a map with no
scene. Rejected as a wider blast radius for a narrower fix.

### Verification

An automated test cannot observe MapLibre layer visibility without a real GL context, so
this needs browser verification: cold-load `/planner`, assert `uae-places` visibility is
not `none` and that place labels render; then `/console` → theater → `/planner` and assert
the same. Both paths must agree. Both were measured disagreeing before the fix.

`MapView` itself has no render test — `MapView.props.test.tsx` mocks `maplibre-gl` away and
asserts only the exported camera defaults, because the component needs a live WebGL canvas.
The `enabled` gate is therefore unit-tested at the hook level (`useBasemap.test.ts`, new,
against the fake-map harness the planner map hooks already use): with `enabled: false` the
hook touches no layer at all, and with the parameter omitted it behaves exactly as today.

## 5. Item 2 — AOI fill

New `planner-aoi-fill` layer on the existing `PLANNER_SOURCES.aoi` source, inserted
**first** in `buildPlannerStyle`'s planner-layer block, i.e. below `planner-rings-fill`.

Resulting stack, bottom to top: `planner-aoi-fill` → `planner-rings-fill` →
`planner-rings-line` → `planner-gaps-fill` → `planner-aoi-line` → `planner-docks-circle`.
Coverage green and gap red continue to read on top of the AOI wash rather than under it.

### Paint

```ts
{
  id: 'planner-aoi-fill',
  type: 'fill',
  source: PLANNER_SOURCES.aoi,
  paint: {
    'fill-color': ['case', ['==', ['get', 'valid'], true], '#e8ecf3', '#ff5a5a'],
    'fill-opacity': ['case', ['==', ['get', 'valid'], true], 0.07, 0.14],
  },
}
```

The condition is spelled `['==', ['get', 'valid'], true]` rather than a bare
`['get', 'valid']`: `get` is typed `value` by MapLibre's expression checker while `case`
requires a `boolean` condition, so the bare form fails style validation even though the
underlying property is a real boolean. (`planner-docks-circle`'s existing
`['match', ['get', 'source'], …]` is fine because `match` does accept a `value` input.)

`#e8ecf3` matches the existing `planner-aoi-line`, so outline and fill read as one object.
Neutral steel, not green and not red: green means coverage in this module and red is
reserved for brand and alerts (`PRODUCT.md`). An invalid ring — which `computeCoverage`
excludes entirely — takes the alert tint. `aoiFeatures` already emits `valid` as a feature
property, so no source change is needed.

**CORRECTION (found in browser verification, after implementation).** This section
originally justified the invalid tint by claiming it makes "excluded from coverage" visible
on the map rather than only in the `INVALID GEOMETRY` badge. That claim is false, and the
red branch is in practice unreachable. MapLibre's GeoJSON tiler drops a self-intersecting
ring outright: with a bowtie AOI in the plan, `querySourceFeatures('planner-aoi')` returns
only the valid AOI, and neither `planner-aoi-fill` nor `planner-aoi-line` paints anything
for the invalid one. An invalid area is therefore *invisible* on the map — arguably worse
than a red wash, since the user sees nothing at all where they drew.

The layer as specified is still correct and still fixes the reported bug (a valid AOI now
reads before any dock exists), so nothing here was rebuilt. But the tint is dead code for
the invalidity case that actually occurs, and making an invalid area visible needs a
different mechanism — rendering it from its bounding box or convex hull, which the tiler
will accept. Recorded as a follow-up rather than smuggled into this pass.

A polygon is filled the moment `handleDrawFinish` commits it. No docks required, which is
the reported symptom.

### Test

`plannerStyle.test.ts` asserts the layer exists, sits below `planner-rings-fill`, and
carries the valid/invalid case expressions. Opacity values are a visual judgement and get
browser confirmation, not an assertion.

## 6. Item 3 — Dock radius slider

Replaces the `type="number"` input in `Inspector.tsx`'s `DockInspector`.

### Control

- A `.pl-slider` range input in kilometres, matching the left panel's coverage-parameter
  sliders so the planner has one slider idiom rather than two input idioms.
- The existing `.pl-radius-val` readout (`NN.NN KM`) becomes the slider's live value
  display; the existing `BOUND BY …` line and cap-headroom line stay as they are.
- `RESET TO DERIVED`, rendered only when `radiusKmOverride != null`. The number input got
  "back to derived" for free by being cleared to empty; a slider has no empty state, so
  the affordance has to be explicit or the derived value becomes unreachable once touched.

Moving the slider sets `radiusKmOverride`. Pressing `RESET TO DERIVED` sets it to
`undefined`. Both go through the existing `patchDock`.

### Range

- `min` 0, `step` 0.1 — matching the number input's old `min`/`step` exactly.
- `max` = `Math.ceil(breakdown.enduranceKm)`, the airframe's physical reach.

This narrows what is expressible: the number input accepted any value, including one
beyond the aircraft's endurance. An endurance ceiling is the honest bound for a planning
tool, and the user was asked about it and accepted it.

One exception, so the control cannot lie about stored state: if `radiusKmOverride` exceeds
that ceiling — reachable via `IMPORT PLAN` or a hand-edited plan, since `parsePlan`
deliberately does not validate it — `max` extends to `Math.ceil(radiusKmOverride)`. This
mirrors the trick `DockInspector` already uses for an incompatible stored `droneModel`,
where the stored value is added back as a visibly-marked option rather than letting the
`<select>` silently display a different value than the plan holds.

### Tests

`Inspector.test.tsx`: dragging the slider writes `radiusKmOverride`; `RESET TO DERIVED`
appears only with an override set and clears it; `max` tracks the drone model's endurance;
an out-of-range stored override extends `max` rather than being clamped or hidden.

## 7. Item 4 — Map-click selection in the planner

New `useMapPlannerSelection(mapRef, ready, enabled)` in `planner/map/`, following the
console's `selection/useMapSelection.ts` conventions rather than inventing new ones.

### Behaviour

| Gesture | Result |
| --- | --- |
| Click `planner-docks-circle` | Select that dock; inspector opens |
| Click `planner-rings-fill` | Select that dock (forgiving target, console's convention) |
| Click `planner-aoi-fill` | Select that AOI |
| Click bare map | Clear selection |
| Hover any of the above | Pointer cursor |

The forgiving ring target is ported deliberately: a dock circle is 5px, and the console
already treats its coverage ring as a large click target for the same reason
(`useMapSelection`'s `onCoverageClick`). A dock hit always wins over the ring or AOI fill
beneath it, and a ring wins over an AOI fill, so the specific target beats the general one
— the same precedence `useMapSelection` applies between dots and coverage.

This is what closes the reported radius complaint: the click that a user naturally makes
now lands on the inspector holding the new slider.

### Interaction with existing capture modes

Selection is live only when `drawMode === 'idle' && !dockPlacement.placing`, passed in as
`enabled` from `PlannerShell`, which already owns both pieces of state. This is the
established discipline in these files (`Important 5` and `Minor 6` in
`useDockPlacement.ts`): one active capture mode at a time, expressed as a gate rather than
as handlers that fight over the same click.

One new hazard: `useDockPlacement`'s drag commits on `mouseup`, and MapLibre fires a
`click` after a drag that never moved. A drag that *did* move must not also select. The
hook tracks whether the pointer moved past a small pixel threshold between `mousedown` and
`mouseup` on a dock and suppresses the selection click when it did. A click on a dock with
no movement selects it, which is the behaviour a user expects and the console already has.

### Tests

`useMapPlannerSelection.test.ts` against the existing mock-map harness the other planner
map hooks use: each layer's click selects the right entity; bare-map click clears; the
`enabled` gate suppresses everything; dock precedence over ring over AOI; a moved drag does
not select; every listener registered is removed on cleanup (the constraint the other
planner map hooks are already held to).

## 8. Item 5 — Selection visible on the planner map

Today selection shows only as a left-panel row border. The console highlights the selected
entity on the map via `setFilter('coverage-line-hi', …)` (`updateLiveLayers.ts:118`).

`usePlannerLayers` gains the current `selection` and applies:

- New `planner-rings-line-hi` layer, brighter and thicker than `planner-rings-line`,
  filtered to the selected dock id — the direct analogue of `coverage-line-hi`.
- New `planner-aoi-line-hi` layer, solid white where the ordinary outline is dashed,
  filtered to the selected AOI id.

Both are separate `-hi` layers rather than a selected-state paint bump on the existing
`planner-aoi-line`: a filter selects which *features* a layer draws, so it cannot vary
another layer's paint per feature. Two layers filtered to one id each means both highlights
work by the identical mechanism, which is also the console's (`coverage-line-hi`), instead
of by two different ones.

Both are `setFilter` calls on a filtered-to-nothing layer when selection is `null`, so
selection changes never rebuild a layer — consistent with the module's existing rule that
the map is fed imperatively while panels re-render through React.

`usePlannerLayers`'s existing dependency discipline matters here: the current effect keys
on `plan.aois`/`plan.docks` specifically so a plan-name keystroke does not rebuild every
ring buffer. The selection filter goes in its **own** effect keyed on `selection` alone, so
selecting a dock does not rebuild ring geometry either.

## 9. Item 6 — `LAYERS` discoverability and topbar order

### Label

`PlannerLayersMenu`'s trigger becomes `LAYERS · DARK ▾`, the console's format from
`Topbar.tsx:88`. `LAYER_LABELS` and `LAYER_ORDER` are currently duplicated verbatim in
`console/chrome/LayersMenu.tsx`, `console/chrome/Topbar.tsx` and
`planner/ui/PlannerLayersMenu.tsx` — three copies of one fact, in a codebase whose own
comments record that its two worst shipped bugs were duplicated facts drifting apart
(`basemap.ts`'s header). They move to one shared module that all three import. This is the
only change §3 permits on the console side, and it is an extraction, not a behaviour
change.

### Order

The planner tool row is regrouped to the console's arrangement — brand and chips, `.sp`
spacer, then the action row with `LAYERS` leading it, exactly where `#btn-layers` sits in
the console:

```
[e& brand] [OfflineChip] ——— spacer ——— [LAYERS · DARK ▾] [DRAW ▾] [+ DOCK]
[SUGGEST LAYOUT] [IMPORT AOI] [IMPORT PLAN] [EXPORT PLAN] [← MODULES]
```

Same position and same label format in both modules, so the control is in one place in the
user's memory instead of two.

`OfflineChip` is added because the console has it and the planner does not, while offline
mode materially changes what the planner's map can show (`usePlannerBasemap` passes
`eff = null` when offline, hiding every raster). A planner user currently gets no
indication of that.

`OfflineChip` currently hardcodes `className="chip warn"`, styled by `chrome/chrome.css`,
which `planner.css`'s header records the planner deliberately does not import. It gains an
optional `className` prop defaulting to `'chip warn'`; the planner passes its own `pl-*`
classes. One component and one copy of the user-facing string, each module keeping its own
styling and the console's rendered markup unchanged.

No clock: the console's is a live-operations affordance, and a planning tool does not need
one. Not every console element belongs here — unification means the shared things agree,
not that the two topbars become identical.

## 10. Item 7 — Bright-basemap panel legibility

`planner.css` already opaques `.pl-side`/`.pl-rpanel` on the light/sat/terrain basemaps
(added when `LAYERS` landed). Verification over satellite shows it is not enough: the inner
`.pl-panel` tiles keep translucent `var(--panel2)`, and `AOI ONE`, `405.7 KM2` and the dock
rows wash out against bright imagery.

The rule extends to the inner tiles and the `.planner-summary` strip, matching the
console's comment on its own equivalent rule (`chrome.css:295-306`) that the inner
translucent tiles are expected to read against an opaque backing.

Verified by screenshot on each of the four basemaps, since contrast is not something the
unit tests can see.

## 11. Item 8 — Planner topbar responsive drop-out

Measured: at a 1024px viewport the `← MODULES` link's right edge lands at 1080px, fully
off-screen, because every topbar child is `flex: none` with no wrap and no drop-out. The
fixed content needs ~1107px. The console handles this with staged `@media` rules
(`chrome.css:564-586`) that drop decorative elements first.

The planner takes the same staged approach, shedding in order of disposability: the brand
sub-label (`AOI · DOCKS · COVERAGE`), then `IMPORT PLAN`'s label to an icon-tight form,
then tightening `gap`. Nothing that is the only entry point to a feature is ever dropped —
the constraint the console's own rule comments state.

The left/right panel widths (318px + 340px, leaving a 366px map at 1024px) are a separate
and larger responsive question. Out of scope: the product targets large presentation
displays, and narrowing the panels is a layout redesign, not a polish pass. Recorded.

## 12. Items 9 and 10 — Naming

### Dock names

Two call sites disagree:

- `useDockPlacement.ts`'s `dockFromClick`: `DOCK ${seq}` zero-padded, where the caller
  passes `plan.docks.length + 1`.
- `autoPlace.ts`'s `makeDock`: `PROPOSED ${lon.toFixed(3)} ${lat.toFixed(3)}` —
  e.g. `PROPOSED 54.684 24.247`.

Both are also collision-prone through `length + 1`: place three docks, remove the second,
place another, and the new one is `DOCK 03` alongside the existing `DOCK 03`.

One shared `nextDockName(plan)` in `domain/plan.ts`, called by both. It numbers from the
highest `DOCK NN` already in the plan, not from array length, so removals cannot cause a
collision. Auto-placed docks get the same `DOCK NN` names.

This changes `dockFromClick(lngLat, seq)`'s signature: the caller currently computes
`plan.docks.length + 1` and passes a number, which is the collision. It takes the resolved
name instead, keeping the helper pure and leaving the plan lookup with the caller that
already holds the plan. `autoPlace.ts`'s `makeDock` numbers sequentially within its own run,
since `suggestLayout` builds a complete replacement array (see §3's out-of-scope note) and
the run's first dock is therefore always `DOCK 01`.

Dropping `PROPOSED` loses nothing: `source: 'auto'` already drives the `AUTO` badge in
`PlanTree` and the `#7aa2f7` circle colour in `plannerStyle.ts`. Provenance is a state the
UI already renders; baking it into the name duplicated that in the one field the user is
expected to edit. A name is an identity; a source is a state.

### AOI names

- `Planner.tsx`'s `handleDrawFinish`: `AOI ${plan.aois.length + 1}` — same collision.
- `kml.ts:89`: the KML placemark's own name, uppercased, or `IMPORTED AREA`. Importing one
  file twice yields two `AOI ONE`s — reproduced live, and visible in the autosaved plan
  found on the dev server.

Two helpers in `domain/plan.ts`:

- `nextAoiName(plan)` — `AOI N` from the highest existing N, for the draw path.
- `uniqueName(base, taken)` — appends ` (2)`, ` (3)` … on collision, for the import path,
  which must preserve the author's chosen name where it can.

Both are explicit helpers called by the three call sites, **not** folded into `addAoi`.
`addAoi` is a pure domain setter, and `handleImportPlanFile`/`loadAutosave` reach the store
through `setPlan` rather than through it — a name mutation hidden inside `addAoi` would
apply to KML import and not to plan import, an invisible split. Keeping it explicit puts
the choice at each call site, where the difference is intentional and readable.

Imported and autosaved plans keep their names verbatim. Renaming a user's plan on load
would be a data change disguised as a polish fix.

### Tests

`plan.test.ts`: numbering from max not length; a removal then an add does not collide;
`uniqueName` suffixes correctly and leaves a non-colliding name untouched.
`autoPlace.test.ts`: auto docks carry `DOCK NN` names and `source: 'auto'`.

No existing test pins the `PROPOSED …` format, so nothing has to be rewritten to
accommodate the change. (`suggestOutcome.test.ts:8` builds fixture docks named
`PROPOSED ${n}`, but that is a local fixture label, not an assertion about what
`autoPlace` produces.) `useDockPlacement.test.ts` does assert `DOCK 01`/`DOCK 12`, and
those assertions survive — the format they pin is the one being adopted everywhere.

## 13. Data flow

Nothing here changes the plan schema, so `schemaVersion` stays at 1 and existing exported
plans and autosaves load unchanged. `radiusKmOverride`, `valid` and `source` are all
existing fields; the slider, the fill's valid/invalid case and the naming helpers read
fields the domain already carries.

Selection stays UI-only in `planStore` and is never serialized, so a plan round-trip is
unaffected by items 4 and 5.

## 14. Risks

**Ordering fragility (§4).** Removing `useBasemap` from the planner is the fix, but a
future `MapView` change could reintroduce a shared writer. Mitigated by `manageBasemap`
being an explicit prop with a comment, and by the browser check that both arrival paths
agree.

**Click contention (§7).** The planner map now has four gestures competing for one click:
draw vertex, dock placement, dock drag, and selection. Three already coexist through the
`drawModeIdle`/`placing` gates; selection is the fourth and takes the same gate. The
drag-then-click suppression is the genuinely new hazard and is the one behaviour worth
verifying by hand in the browser as well as in tests.

**`dockFromClick`'s signature change (§12).** Its `seq: number` parameter becomes a
resolved name, so every call site and the four `dockFromClick` assertions in
`useDockPlacement.test.ts` are touched. Mechanical, but it is the one place in this pass
where an existing exported signature changes rather than gaining an optional parameter.

## 15. Verification

Per-item tests are listed in each section. Beyond those:

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Browser verification on `/planner` for the things no test can see: cold-load cartography
  vs. via-console cartography, the AOI fill on commit before any dock exists, the radius
  slider driving the ring on the map, click-selection on dock/ring/AOI, selection highlight,
  panel legibility on all four basemaps, and the topbar at 1024/1280/1600px.
- Browser verification on `/console` that it is unchanged, since §9 and §12 touch shared
  modules it imports.
