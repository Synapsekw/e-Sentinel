# Deployment Planner — Module Scope & Design

**Date:** 2026-07-23
**Status:** Draft for review
**Module:** `planner.html` (module 02 on the landing page)

## 1. Purpose

The Deployment Planner turns e& Sentinel from a pure simulation into a pre-sales / solution-engineering tool: given a customer's area of interest (AOI), design a dock-based drone deployment — dock placement, coverage, overlap, mission plan — and produce a shareable deployment proposal. An AI co-planner (Claude via the Anthropic API) can generate or refine deployments conversationally.

**Primary user:** Danijel and e& solution engineers building customer proposals.
**Secondary user:** customers watching the plan being built live in a meeting.

## 2. Decisions already made

- **Full React migration** (revised 2026-07-23, superseding the earlier hybrid decision): the entire product — including the existing simulation — is ported to **React + TypeScript (Vite)**. The sim port is Phase 1 and happens before any new module is built.
- **Cloud-native first** (agreed 2026-07-23): the `file://` double-click requirement is **dropped**. The app is a normal served web app (GitHub Pages today). Containerization for private/on-prem deployment (static bundle behind nginx) is deliberately deferred as a separate small project at the very end.
- **Code quality tooling**: strict TypeScript, ESLint (type-checked rules), Prettier, pre-commit hooks, CI gate — set up before porting begins. CI/CD stays intentionally simple (single developer).
- Static landing page (`index.html`) is live during the transition; the React app takes over the site root when the Phase 1 port lands.

## 3. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript, Vite | One app, one stack for all modules; typed domain model pays off for plans/geometry |
| Routing | React Router (`/`, `/console`, `/planner`, `/telemetry`, `/compliance`) | Each module is a lazy-loaded route — standard SPA, code-split per module |
| Map | MapLibre GL (npm) | Same engine the console already uses; shared map wrapper component across sim + planner |
| Drawing | `terra-draw` (+ MapLibre adapter) | Maintained, MapLibre-native polygon/rect/circle/point drawing with vertex editing |
| Geometry | `@turf/turf` (buffer, union, intersect, area, bbox) | Coverage %, overlap and auto-placement math |
| KML/KMZ | `@tmcw/togeojson` (KML→GeoJSON) + `fflate` (unzip KMZ) | Small, battle-tested; KMZ is just a zip containing `doc.kml` |
| State | Zustand (or React context if it stays small) | Simple, no boilerplate |
| AI | Anthropic Messages API, direct from the browser | See §7 |
| Tests | Vitest for domain/geometry logic | Existing sim tests (`node --test`) stay untouched |

**Repo layout**

```
app/                      # Vite + React + TS project — the whole product
  src/
    shared/               # brand tokens, layout chrome, map wrapper, common UI
    modules/
      landing/            # module select screen
      console/            # the simulation (ported from assets/js in Phase 1)
      planner/
        domain/           # types + pure logic (plan, coverage, estimates) — unit tested
        map/              # planner map layers, terra-draw integration
        io/               # KML/KMZ import, plan JSON import/export, KMZ export
        ai/               # Anthropic client, tool schema, chat state
        ui/               # panels, chat, summary components
      telemetry/          # later
      compliance/         # later
assets/, console.html     # legacy vanilla sim — kept working during the port, deleted after
```

- Build artifacts are **not committed**; CI builds `app/` and the Pages deploy publishes `app/dist`.
- Brand tokens (colors, mono-label idiom) live once in `app/src/shared/` (values taken from `console.css` `:root`).

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

## 7. Deployment model (cloud-native)

- **Now:** static SPA build (`app/dist`) deployed to GitHub Pages on push to `master`. No servers, no secrets in the build. Videos and other large media are copied into the deploy alongside the bundle.
- **Data:** all client-side for now (localStorage autosave + plan JSON export/import). When Telemetry/Compliance need real persistence, that's the point to introduce a backend — not before.
- **Later (separate final project):** containerize for private/on-prem deployment — static bundle behind nginx, single small Dockerfile. Nothing in the architecture blocks this; it's packaging, not redesign.
- **AI:** Anthropic API called directly from the browser with a user-supplied key (internal tool). If the app ever goes customer-facing, add a tiny key-proxy at that time.

## 8. Phased build plan

0. **Phase 0 — Foundation (done first):** `app/` scaffold — Vite + React + TS (strict), ESLint (type-checked flat config), Prettier, EditorConfig, Vitest, pre-commit hook, CI job. React landing page + placeholder module routes.
1. **Phase 1 — Simulation port:** port the vanilla sim (~7k lines: globe entry, engine, router, map, panels, manual control, mission videos, flight requests) to `app/src/modules/console/`. Engine/router stay framework-free TS (ported nearly 1:1, unit tests carried over); UI layers become React components around a shared MapLibre wrapper. Legacy `console.html` stays deployed until the port reaches feature parity, then the legacy files are deleted and the React app takes over the site root.
2. **Phase 2 — Planner: AOI:** MapLibre planner route, KML/KMZ upload, terra-draw AOI tools, plan JSON export/import.
3. **Phase 3 — Planner: docks & coverage:** manual placement, range model reuse (shared with the ported sim), coverage engine + gap layer, auto-placement, summary panel.
4. **Phase 4 — Planner: missions & exports:** mission assignments, utilization checks, KMZ export.
5. **Phase 5 — AI co-planner:** chat panel, key settings, strict tool schema, proposal overlay + accept/discard, self-correction loop.
6. **Final (separate project):** containerization for private deployment.

Each phase lands independently usable.

## 9. Testing

- Vitest unit tests for pure logic: sim engine/router (tests ported from `tests/*.test.js` during Phase 1), planner `domain/` (coverage math fixtures, KML/KMZ parsing, auto-placement determinism, utilization rules).
- CI: one simple job — install, lint, typecheck, test, build. Legacy `node --test` sim tests keep running until the port lands, then retire with the legacy code.
- Browser smoke-check via the dev-server preview flow.

## 10. Risks & open questions

- **Sim port regression risk** — the sim is the demo-critical asset. Mitigations: keep legacy `console.html` deployed until parity; port engine/router with their tests first; visual side-by-side checks per feature before deleting legacy code.
- **Turf on huge AOIs** (emirate-scale MultiPolygons): simplify geometry above a vertex threshold before coverage math.
- **AI key handling** is deliberately lightweight (internal tool). Flag before any customer-facing deployment.
- **Open:** dock/drone catalog contents (which DJI dock+drone combos and their real radii/endurance) — currently seeded from the sim's 3/5 km model; needs product input to be proposal-grade.
- **Open:** should accepted AI proposals record provenance (who/what generated each dock) in exports? Assumed yes (`source` fields) — cheap to keep.
