# e& UAE Drone Operations Console v2 — Design Spec

Date: 2026-07-22
Status: Approved design, pending spec review

## 1. Overview

A high-fidelity simulated command & control system for a nationwide fleet of DJI dock-based
drones across the UAE, in the spirit of DJI FlightHub 2 but visibly better. Everything is
simulated, but it must read as a real, live, national-scale C2 system on a big screen.

The visual language is the user's existing "UAE Operations Console" (reference/embedded_sim.html),
extended — not replaced. A new orbital globe entry scene dives continuously into the UAE map.

**Deliverable:** a folder that runs by double-clicking `index.html`. No server, no build step,
works from `file://`, survives loss of internet mid-demo.

## 2. Goals / Non-goals

Goals:
- ~104 dock stations across all 7 emirates with hand-placed, plausible real coordinates.
- Continuous autonomous simulated operations (launch → fly → survey → RTB → charge) that make
  the screen feel alive at all times.
- Globe-to-UAE cinematic entry; switchable monochromatic map layers on both globe and map.
- Operator interactions: dock cards, drone follow + manual control, point-and-click mission
  creation across 7 mission types.
- Mission debriefs with per-type analytics and an AI mission video slot (Higgsfield library
  drops in later without code changes).
- Offline fallback map so the demo never dies.

Non-goals:
- No real DJI/FlightHub integration, no real UTM/GCAA integration.
- No backend, no persistence beyond localStorage (nice-to-have, not required).
- No mobile/touch layout: target is desktop / large screen (min 1280px wide).
- No live Higgsfield generation at runtime (videos are pre-generated files).

## 3. Visual design system (from reference/embedded_sim.html)

Tokens (verbatim):
- `--bg:#0a0b0e`, panels `rgba(255,255,255,.035)` / `.06`, hairlines `rgba(255,255,255,.09)`
- text `#c9cfda`, dim `#7d8697`, red `#ff5a5a`, deep red `#BC0000`, amber `#fbbf24`, ok `#4ade80`
- Fonts: `'Segoe UI', system-ui` stack for UI; `ui-monospace, Consolas` stack for data,
  micro-labels 9.5px, letter-spacing .22em, uppercase.
- Components: 56px top bar with blur backdrop; pill chips with glowing status dots; 12px-radius
  translucent panels; `.tbtn` outline buttons; legend card; coords chip.
- Map styling: CARTO dark tiles; red dock dots with ping rings; amber mobile-command-vehicle
  diamonds; dashed red corridors with mono labels; e& logo top-left.

Status color discipline: green = nominal, amber = warning/charging, red = alert AND brand.
Red dock dots (as in the reference) stay; alerts differentiate with blink + ring.

Layout (single screen, fixed):
- **Top bar (56px):** e& logo, title "UAE OPERATIONS CONSOLE / PHYSICAL INTELLIGENCE · NATIONAL
  GRID", grid status chip, docks/airborne/alerts chips, sim time-scale control (1×/4×/16×),
  layer switcher, MEDIA button (opens mission video library), clock (GST), GLOBE button
  (returns to orbit).
- **Left sidebar (318px, collapsible):** national grid stats; filter chips (emirate, status);
  scrollable dock/fleet list; each row: status dot, dock id + name, drone model, battery, state.
- **Right panel (~340px, contextual):** shows selected dock card, selected drone telemetry +
  actions, mission creation wizard, or mission debrief. Empty state: national activity summary.
- **Bottom strip:** scrolling event ticker + legend toggle.
- **Map:** fills remaining space; MapLibre canvas.

## 4. Architecture

```
E& C&C/
  index.html            single page, classic <script> tags (no ES modules — file:// safe)
  assets/
    css/console.css
    js/vendor/maplibre-gl.js  (+ css)   vendored, offline-capable
    js/data/docks.js          ~104 docks as JS global (no fetch — file:// safe)
    js/data/geo-uae.js        UAE emirates/coastline/major roads GeoJSON (offline fallback + accents)
    js/data/geo-world.js      simplified world land polygons (globe offline)
    js/data/missions-config.js  7 mission types: patterns, params, analytics templates
    js/data/video-manifest.js   mission type → video file mapping
    js/sim/engine.js          tick loop, entity state machines, event generation
    js/sim/router.js          route/pattern generation (lawnmower, corridor, orbit, perimeter)
    js/ui/map.js              MapLibre init, layers, globe entry, dock/drone rendering
    js/ui/panels.js           sidebar, right panel, ticker, debrief
    js/ui/control.js          manual drone control + mission creation interactions
    js/main.js                boot, wiring
  videos/
    README.md                 naming convention + how to add Higgsfield output
    (missionType).mp4         dropped in later; placeholder used when missing
  reference/                  user's original files (unchanged)
```

All data files assign globals (`window.DATA_DOCKS = [...]`) so nothing needs fetch/CORS.
MapLibre style objects are built in JS with inline GeoJSON sources — no style.json fetches.

### Map engine

MapLibre GL JS with globe projection. One continuous camera from orbit to street level.

Layers (switcher applies to globe AND map):
- **DARK** (default): CARTO dark-matter raster tiles.
- **LIGHT:** CARTO positron raster tiles.
- **SATELLITE:** Esri World Imagery raster tiles.
- **TERRAIN:** Esri World Terrain/Topo raster tiles.
- On top, always: UAE accent vector layer (emirate borders, corridor lines), dock/drone layers.

Offline fallback: a raster-tile error counter trips "OFFLINE MODE": raster layers hidden,
embedded vector world + UAE GeoJSON shown styled to match the dark theme, banner chip appears.
Rechecks connectivity periodically; restores tiles when back.

Dock/drone rendering: docks and drones are MapLibre GeoJSON sources updated per tick
(symbol/circle layers); ping rings and selected-drone effects via animated paint properties.
Target: 60fps with 104 docks + 25 airborne drones.

### Globe entry

- Boot scene: globe at orbital altitude, slow auto-rotation, drag to rotate; stars + subtle
  atmosphere; pulsing red beacon + "UNITED ARAB EMIRATES · GRID ONLINE · 104 DOCKS · CLICK TO
  ENTER THEATER" tag; top bar minimal (logo, clock).
- Click beacon/tag → `flyTo` UAE national view (~2.5s, ease-out). Altitude readout during descent.
- GLOBE button in top bar returns to orbit (reverse move). Layer switcher restyles the globe too.
- Offline: globe renders from embedded world GeoJSON (vector), so entry still works.

## 5. Simulation model

### Entities

Dock: `{id, name, emirate, coords, drone, battery, state}` — states:
`ready | launching | drone-away | landing | charging | fault | offline`.
IDs follow the reference convention: `AUH-001`, `DXB-017`, `SHJ-003`, `RAK-…`, `FUJ-…`,
`AJM-…`, `UAQ-…`, `AAN-…` (Al Ain), western region under AUH.

Drone: `{id, model, dockId, pos, alt, heading, speed, battery, state, mission}` — states:
`docked | takeoff | transit | on-task | manual | rtb | landing`. Models: DJI M4TD, M4D, M350.

Mission: `{id, type, dockId, waypoints, params(alt, speed), progress, startedAt, state,
analytics, videoKey}` — states: `planned | active | paused | complete | aborted`.

Event: `{time, level(info|warn|alert), source, message}` → ticker + event log.

### Engine

- `requestAnimationFrame` loop with sim-time accumulator; time-scale 1×/4×/16×.
- Autonomous scheduler keeps ~12–25 drones airborne: picks idle docks, generates missions with
  type-appropriate routes near that dock (router.js patterns), respects battery/charging cycles.
- Route patterns: lawnmower grid (construction/mapping, parks), corridor sweep along road
  polylines (highway, pipelines), orbit (construction POI), perimeter loop (security),
  A-to-B (delivery, emergency dispatch).
- Ambient events: wind gusts (holds), dock faults, AI detections tied to mission type,
  battery warnings. 2–3 standing alerts at any time so the board never looks static.
- Determinism not required; plausibility is. All numbers stay within realistic DJI envelopes
  (alt ≤ 120m AGL default, speed ≤ 21 m/s, 35–45 min endurance).

## 6. Operator interactions

- **Select dock** (map or list): right panel dock card — photo-less identity block, drone,
  battery, state, mission history count, actions: LAUNCH MISSION (opens wizard pre-filled),
  OPEN/CLOSE DOCK (cosmetic), LOCATE (fly camera).
- **Select drone** (map click or list): telemetry panel (alt, speed, heading, battery, link,
  distance home), live FPV placeholder frame, actions: FOLLOW (camera tracks), TAKE CONTROL,
  RETURN TO DOCK, PAUSE/RESUME.
- **Take control:** map cursor becomes crosshair; click = fly-to-point (drone turns and goes);
  shift-click = queue waypoints; on-screen altitude +/- nudge; RELEASE returns to auto. Ticker
  logs "MANUAL CONTROL — OPERATOR" / release.
- **New mission wizard** (right panel, 3 steps):
  1. Type (7 tiles) + launch dock (nearest preselected).
  2. Click waypoints on map (or drag area box for lawnmower types); live route preview with
     distance/duration estimate.
  3. Params (altitude, speed, pattern spacing where relevant) → LAUNCH.
- **Mission debrief** (on completion, right panel + MEDIA entry): summary stats, per-type
  analytics block, AI mission video player, EXPORT-style buttons (cosmetic).

## 7. Mission types & analytics templates

| Type | Pattern | Debrief analytics (simulated) |
|---|---|---|
| Security & surveillance | perimeter/patrol loop | intruder/anomaly detections, plates flagged, coverage % |
| Infrastructure inspection | corridor along asset | thermal anomalies, defect count by severity, asset list |
| Emergency / first response | A-to-B + orbit | time-to-scene, scene assessment tags, units guided |
| Delivery & logistics | dock-to-dock A-to-B | payload, ETA vs actual, chain-of-custody timeline |
| Construction monitoring & mapping | lawnmower grid | area covered, progress % vs last survey, volume delta |
| Highway inspection | corridor along E-road | vehicles flagged, incidents, pavement defect count |
| Parks vegetation | lawnmower over park | palm/tree count, NDVI mean, stressed-plant % |

Numbers generated within plausible ranges, correlated with mission length.

## 8. AI mission videos (Higgsfield)

- `videos/` holds MP4s; `video-manifest.js` maps `missionType` → filename(s). If multiple per
  type, rotate. If file missing → animated canvas placeholder ("AI MISSION VIDEO — PENDING
  GENERATION") so the console is complete before videos exist.
- Naming: `<type>-<variant>.mp4`, e.g. `highway-01.mp4`, `parks-01.mp4`.
- Debrief player: 16:9, mono corner data (callsign, time, GST), REC-style chrome per reference.
- Video generation itself happens in a later session via Higgsfield MCP once the user connects
  it (confirmed not currently available in-session). Target: 1–2 videos per mission type,
  each depicting dock-open → takeoff → flight POV with analytics overlay → landing.
- The MEDIA view (opened from the top bar) lists all mission videos generated during the
  session with their debriefs.

## 9. Error handling & resilience

- Tile failures → offline vector mode (section 4), chip in top bar, auto-recover.
- Missing video file → placeholder, no console errors.
- Sim engine guards: drones never exceed UAE bounds, never underrun battery below RTB reserve
  (forced RTB at 25%), no NaN propagation (clamped inputs).
- `file://` constraints respected: no fetch of local files, no ES modules, vendored libs.
- If MapLibre fails to load entirely (corrupt vendor file), show a static branded error state
  rather than a blank page.

## 10. Acceptance criteria

1. Double-click `index.html` on Windows → globe appears within 3s, no console errors.
2. Click UAE → continuous dive lands on UAE national view showing ~104 docks.
3. Layer switcher changes globe and map styles (DARK/LIGHT/SATELLITE/TERRAIN) live.
4. With internet disabled, reload: globe + UAE map still render (vector fallback), sim runs.
5. At any moment ≥12 drones airborne autonomously; ticker updates ≤ every 5s of sim time.
6. Dock click → card; drone click → telemetry + FOLLOW + TAKE CONTROL; click-to-go works.
7. Mission wizard: create a highway inspection along E311 with ≥5 waypoints, launch, watch it
   fly, receive debrief with analytics and video slot.
8. All 7 mission types can be created and produce type-correct analytics.
9. 60fps map interaction on a mid-range laptop with full fleet active (measured via devtools).
10. No em dashes in UI copy; mono micro-label style matches reference exactly.

## 11. Testing

- Manual demo script (docs/demo-script.md, written during implementation) covering criteria 1–8.
- Smoke-test page checks (browser console clean on boot, offline toggle, mission lifecycle).
- Performance check with devtools FPS meter at full fleet.
