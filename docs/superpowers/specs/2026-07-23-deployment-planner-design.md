# Deployment Planner — Module Scope & Design

**Date:** 2026-07-23
**Status:** Draft for review
**Module:** `planner.html` (module 02 on the landing page)

## 1. Purpose

The Deployment Planner turns e& Sentinel from a pure simulation into a pre-sales / solution-engineering tool: given a customer's area of interest (AOI), design a dock-based drone deployment — dock placement, coverage, overlap, mission plan — and produce a shareable deployment proposal. An AI co-planner (Claude via the Anthropic API) can generate or refine deployments conversationally.

**Primary user:** Danijel and e& solution engineers building customer proposals.
**Secondary user:** customers watching the plan being built live in a meeting.

## 2. Decisions already made

- **Hybrid stack** (agreed 2026-07-23): new modules are built in **React + TypeScript (Vite)**; the existing simulation stays vanilla JS at `console.html` untouched.
- **`file://` must keep working.** The whole product remains double-clickable from a folder / USB stick.
- Landing page (`index.html`) is live and links module 02 to `planner.html` (currently disabled/"IN DEVELOPMENT").

## 3. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript, Vite | Agreed hybrid approach; typed domain model pays off for plans/geometry |
| `file://` compatibility | `vite-plugin-singlefile` → emits one self-contained `planner.html` | ES module *files* are blocked on `file://`, but **inline** module scripts work; single-file build sidesteps it entirely |
| Map | MapLibre GL (npm, bundled) | Same engine as the console → identical basemaps/look; vendor CSS+JS inlined |
| Drawing | `terra-draw` (+ MapLibre adapter) | Maintained, MapLibre-native polygon/rect/circle/point drawing with vertex editing |
| Geometry | `@turf/turf` (buffer, union, intersect, area, bbox) | Coverage %, overlap and auto-placement math |
| KML/KMZ | `@tmcw/togeojson` (KML→GeoJSON) + `fflate` (unzip KMZ) | Small, battle-tested; KMZ is just a zip containing `doc.kml` |
| State | Zustand (or React context if it stays small) | Simple, no boilerplate |
| AI | Anthropic Messages API, direct from the browser | See §7 |
| Tests | Vitest for domain/geometry logic | Existing sim tests (`node --test`) stay untouched |

**Repo layout**

```
planner/                  # Vite + React + TS project (new)
  src/
    domain/               # types + pure logic (plan, coverage, estimates) — unit tested
    map/                  # MapLibre setup, layers, terra-draw integration
    io/                   # KML/KMZ import, plan JSON import/export, KMZ export
    ai/                   # Anthropic client, tool schema, chat state
    ui/                   # panels, chat, summary components
  vite.config.ts          # singlefile build, outputs ../planner.html
planner.html              # committed build artifact (repo stays double-clickable)
```

- The built `planner.html` is **committed** (like the rest of the no-build repo) so `file://` users need no toolchain. CI additionally runs `npm run build` in `planner/` to verify it builds, and the Pages deploy stages `planner.html`.
- Brand tokens (colors, mono-label idiom) are replicated in a small shared CSS/TS constants file matching `console.css` `:root` values.

## 4. Domain model (TypeScript)

```ts
interface DeploymentPlan {
  id: string; name: string; customer: string;
  createdAt: string; updatedAt: string;
  aois: Aoi[];                    // one or more areas of interest
  docks: PlannedDock[];
  missionPlan: MissionAssignment[];
  params: CoverageParams;
}
interface Aoi { id: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; source: 'drawn' | 'kml' | 'kmz' | 'ai'; }
interface PlannedDock {
  id: string; name: string; position: [lon: number, lat: number];
  model: DockModel;               // e.g. 'DJI Dock 3'
  drone: DroneModel;              // e.g. 'M4TD' — sets radius, speed, endurance
  radiusKm: number;               // effective operational radius (editable)
  environment: 'urban' | 'rural'; // default radius rule reused from the sim
}
interface MissionAssignment {
  dockId: string; missionType: MissionType;  // the 7 types from missions-config
  flightsPerDay: number; durationMin: number; window: 'day' | 'night' | '24h';
}
interface CoverageParams { targetOverlapPct: number; requiredCoveragePct: number; }
interface CoverageResult {                    // derived, never stored
  coveragePct: number;            // area(union(dock buffers) ∩ AOI) / area(AOI)
  overlapPct: number;             // multi-covered area / covered area
  uncovered: GeoJSON.MultiPolygon;// rendered as hatched "gap" layer
  perDock: { dockId: string; contributionKm2: number }[];
}
```

**Reuse from the sim:** the urban 3 km / rural 5 km radius rule and urban-center circles from `assets/js/data/docks.js` are ported into `planner/src/domain/rangeModel.ts` (typed re-implementation, same constants) so planner rings match console rings. Mission types mirror `missions-config.js`.

## 5. Features

### 5.1 AOI definition
- **Upload KML / KMZ** (file input + drag-drop onto map). KMZ → unzip with fflate → find `*.kml` → togeojson → extract Polygon/MultiPolygon features (points/lines listed but ignored for coverage). Invalid/empty files produce a clear error toast. File API works fine on `file://`.
- **Draw on map**: polygon, rectangle, circle tools (terra-draw); vertex edit, move, delete. Freehand not needed.
- Multiple AOIs per plan; each gets a name and area readout (km²).

### 5.2 Dock placement & coverage
- **Manual placement**: click to drop a dock; drag to move; select → edit model/drone/radius in a side panel. Coverage ring updates live.
- **Auto-placement (deterministic)**: hex-grid candidate generation over the AOI at spacing derived from radius and `targetOverlapPct`, greedy selection until `requiredCoveragePct` reached. Shown as a "SUGGEST LAYOUT" action; result is editable.
- **Coverage engine** (pure functions in `domain/coverage.ts`): turf buffers per dock → union → intersect with AOI → coverage %, overlap %, uncovered gaps (hatched layer). Recomputed on any change, debounced; all client-side, works offline.

### 5.3 Mission planning
- Per dock: assign mission types, flights/day, duration, operating window.
- Derived stats: total missions/day, flight hours/day, per-mission-type breakdown, rough utilization check (flags a dock scheduled beyond realistic cycle time: flight + charge ≈ 25 min + 35 min per sortie).

### 5.4 Plan summary & export
- Live summary panel: dock count, coverage %, overlap %, gaps count, missions/day, per-emirate/area breakdown.
- **Export / import plan JSON** (the `DeploymentPlan` object; also the persistence story on `file://` — localStorage autosave as convenience, file export as source of truth).
- **Export KMZ** (docks as placemarks + rings + AOI, for Google Earth handoff).
- PDF proposal export: **out of scope for v1** (listed as future work).

### 5.5 Module chrome
- Same visual language as the console: dark `#0a0b0e`, mono uppercase labels, e& logo top-left, "DEPLOYMENT PLANNER" title, link back to landing.
- Layout: map full-bleed; left panel = plan tree (AOIs, docks, missions); right panel = selection inspector; bottom-right = AI co-planner chat (collapsible).

## 6. AI co-planner (Claude via API)

**Interaction model:** a chat panel where the user talks to Claude ("Customer AOI is the uploaded polygon around Khalifa Port. Design a deployment with 20% overlap, security patrols at night, inspections by day"). Claude responds conversationally **and** emits a structured plan the app renders as a *proposal overlay* (ghost docks/rings) that the user can **Accept** (merges into the plan) or **Discard**.

**Mechanics**
- Direct browser → Anthropic Messages API. The TypeScript SDK supports this with `dangerouslyAllowBrowser: true` (sends the CORS opt-in header). Requires internet; the panel shows "AI OFFLINE" and disables itself when unreachable — everything else in the module works offline.
- **API key**: user-supplied, entered once in a settings dialog, stored in `localStorage` only, never committed. Acceptable for an internal pre-sales tool; revisit if the module is ever exposed to customers directly (would then need a tiny key-proxy backend).
- **Model**: `claude-opus-4-8` (default per current guidance), adaptive thinking (`thinking: {type: "adaptive"}`), streaming responses for chat feel.
- **Structured output via strict tool use**: one tool `propose_deployment` with `strict: true` and a JSON schema mirroring `DeploymentPlan` (docks with lon/lat/model/radius, mission assignments, assumptions[]). Tool loop runs client-side; the tool "execution" is rendering the proposal and returning the computed `CoverageResult` back to Claude so it can self-correct ("coverage came out at 87%, add a dock near the gap").
- **Context given to Claude**: system prompt describing the domain (dock/drone catalog, radius rules, mission types, cycle-time constraints) + the current plan state and AOI geometry (simplified with turf to keep tokens sane; cache the static system prompt with `cache_control`).
- Also supports **edit commands** on the existing plan ("push overlap to 30%", "swap Dock 4 to rural radius") via the same tool.

## 7. `file://` constraints (explicit)

| Constraint | Handling |
|---|---|
| ES module files blocked on `file://` | `vite-plugin-singlefile` inlines all JS/CSS into `planner.html` |
| `fetch()` of local files fails | No runtime fetches of local assets; all data bundled. User files come in via File API (works) |
| Map raster tiles need internet | Same behavior as console: tiles online; offline shows dark vector fallback styling (AOI/docks/coverage all render regardless — they're client-side layers) |
| localStorage on `file://` | Works in Chrome/Edge (per-directory origin); treated as convenience cache only — plan JSON export is the durable store |
| Anthropic API | Needs internet by nature; module degrades gracefully |

## 8. Phased build plan

1. **Phase 1 — Scaffold + AOI** (foundation): Vite/React/TS project, singlefile build → `planner.html`, brand chrome, MapLibre map, KML/KMZ upload, terra-draw AOI tools, plan JSON export/import. Landing card flips to ONLINE.
2. **Phase 2 — Docks & coverage**: manual placement, range model port, coverage engine + gap layer, auto-placement, summary panel.
3. **Phase 3 — Missions & exports**: mission assignments, utilization checks, KMZ export.
4. **Phase 4 — AI co-planner**: chat panel, key settings, strict tool schema, proposal overlay + accept/discard, self-correction loop.

Each phase lands independently usable; phases 1–3 have zero external dependencies at runtime.

## 9. Testing

- Vitest unit tests for `domain/` (coverage math on known fixtures, KML/KMZ parsing fixtures, auto-placement determinism, utilization rules).
- Existing `tests/*.test.js` (sim) unchanged; CI gains a `planner` job (install, test, build, verify `planner.html` output matches committed artifact or auto-commits it).
- Browser smoke-check via the existing static-server preview flow.

## 10. Risks & open questions

- **Committed build artifact** can drift from source — mitigated by the CI verify step. Alternative (CI-built only) would break the "copy the folder" workflow; rejected for now.
- **Turf on huge AOIs** (emirate-scale MultiPolygons): simplify geometry above a vertex threshold before coverage math.
- **AI key handling** is deliberately lightweight (internal tool). Flag before any customer-facing deployment.
- **Open:** dock/drone catalog contents (which DJI dock+drone combos and their real radii/endurance) — currently seeded from the sim's 3/5 km model; needs product input to be proposal-grade.
- **Open:** should accepted AI proposals record provenance (who/what generated each dock) in exports? Assumed yes (`source` fields) — cheap to keep.
