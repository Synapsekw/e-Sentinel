# Phase 1B: React MapView + Globe + Scene Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the map/globe rendering layer (`assets/js/ui/map.js` + `globe.js`) to React + TypeScript: one `<MapView>` component owning a single MapLibre instance with the full layer style, a Zustand scene/layer/offline store, and the orbital globe intro with dive-to-theater — mounted at the `/console` route. Static layers only (docks, sites, coverage, geo); live engine data is Phase 1C.

**Architecture:** A single `maplibregl.Map` is created once inside `<MapView>` and held in a ref, never in React state. Scene (`globe`/`console`), basemap `layer`, and `offline` live in a Zustand store; React effects translate store changes into imperative MapLibre calls (basemap visibility, operational-layer visibility, offline fallback). The globe's rAF loops (homing rotation, beacon ping, FX pulses) run outside React in effect-scoped `requestAnimationFrame` drivers. The map instance is shared with descendants (globe overlay now, panels later) via a `MapContext`. The legacy `EC2.onSceneChange` pub/sub is replaced by store subscriptions. The map STYLE (sources + ~36 layers) and the scene/offline logic are a faithful port of the legacy files; the React component/store/hook scaffolding is new code.

**Tech Stack:** React 18, TypeScript (strict), MapLibre GL v5 (npm), Zustand, Vitest (+ jsdom for overlay components), the Phase 1A domain (`@/modules/console/domain`).

## Global Constraints

- **Consumes Phase 1A domain** via the `@/modules/console/domain` barrel: `DATA_DOCKS`, `DATA_SITES`, `DOCK_RANGE`, `SimRouter`, `GEO_UAE`, `GEO_WORLD`, and types. Do not re-implement domain logic. — spec §3 "shared map wrapper across sim + planner".
- **Faithful port of the map surface and scene behavior.** The style object (sources + layers), the basemap/offline logic, the globe orbit-fit / homing-rotation / dive math, and all numeric constants are transcribed from `assets/js/ui/map.js` and `assets/js/ui/globe.js` with no behavior change. Only: globals→React/store, vendored maplibre→npm, glyph URL→BASE_URL-relative. — spec §8.1.
- **Legacy stays live.** Do NOT modify `assets/`, `console.html`, `index.html`, or `deploy.yml`. All new code under `app/`. — Phase 0 invariant.
- **Single map instance.** Exactly one `maplibregl.Map` is constructed, in `<MapView>`, held in a ref. Never store the map in React state or recreate it on re-render.
- **rAF and timers live outside React render.** Globe rotation, beacon ping, and FX pulse drivers are `requestAnimationFrame` loops started in effects and cancelled on cleanup. Never drive them from render.
- **Brand tokens** already in `app/src/shared/tokens.css` (Phase 0). Reuse them; do not hardcode colors that duplicate tokens. Map paint colors are transcribed from the legacy style verbatim (they are data, not theme tokens).
- **Console voice:** mono micro-labels 9.5px/.22em/uppercase; no em dashes in UI copy. Overlay copy ("ENTER THEATER", "ACQUIRING BASEMAP", "ALT … KM · ORBITAL") is transcribed verbatim from the legacy.
- **npm scripts on this Windows checkout:** the repo path contains `&`. Run `npm run ...`/`npm test` via the Bash tool with `export npm_config_script_shell=bash`; before `git commit` also `export PATHEXT=";$PATHEXT"`. npm from `app/`, git from repo root, quote paths.
- **Pages base path** `/e-Sentinel/` (prod) / `/` (dev): glyph and vendored-asset URLs must be built from `import.meta.env.BASE_URL`, never hardcoded.
- **The `@` alias** (`@/*` → `src/*`) is configured (Phase 1A). Import shared/domain code via `@/...`.

---

### Task 1: Dependencies, vendored glyphs, and the app store

**Files:**
- Modify: `app/package.json` (+ `maplibre-gl`, `zustand`; dev: `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`)
- Modify: `app/vite.config.ts` (vitest: keep node default; enable jsdom per-file via pragma)
- Create: `app/public/assets/fonts/…` (vendored glyph PBFs, copied from legacy `assets/fonts/`)
- Create: `app/src/shared/store.ts`
- Test: `app/src/shared/store.test.ts`

**Interfaces:**
- Consumes: nothing new (builds on Phase 0/1A).
- Produces: `useAppStore` (Zustand hook) with state `{ scene: Scene; layer: MapLayer; offline: boolean }` and actions `setScene(s)`, `setLayer(l)`, `setOffline(b)`; exported types `Scene = 'globe' | 'console'`, `MapLayer = 'dark' | 'light' | 'sat' | 'terrain'`. `useAppStore.getState()`/`.subscribe()` available for non-React (rAF) code.

- [ ] **Step 1: Install dependencies**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm install maplibre-gl@^5.0.0 zustand@^5.0.0
npm install -D jsdom@^25.0.0 @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0 @testing-library/dom@^10.4.0
```
Expected: deps added; `maplibre-gl` ships its own TypeScript types (no `@types/maplibre-gl` needed).

- [ ] **Step 2: Write `app/src/shared/store.ts`**

```ts
import { create } from 'zustand'

export type Scene = 'globe' | 'console'
export type MapLayer = 'dark' | 'light' | 'sat' | 'terrain'

export interface AppState {
  scene: Scene
  layer: MapLayer
  offline: boolean
  setScene: (scene: Scene) => void
  setLayer: (layer: MapLayer) => void
  setOffline: (offline: boolean) => void
}

// Global UI store. Scene starts 'globe' (orbital boot), layer 'dark' — matching
// the legacy EC2.state defaults. Non-React code (rAF drivers) reads via
// useAppStore.getState() and reacts via useAppStore.subscribe().
export const useAppStore = create<AppState>((set) => ({
  scene: 'globe',
  layer: 'dark',
  offline: false,
  setScene: (scene) => set({ scene }),
  setLayer: (layer) => set({ layer }),
  setOffline: (offline) => set({ offline }),
}))
```

- [ ] **Step 3: Write the failing store test**

`app/src/shared/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
  })

  it('defaults to the orbital globe scene on the dark basemap', () => {
    const s = useAppStore.getState()
    expect(s.scene).toBe('globe')
    expect(s.layer).toBe('dark')
    expect(s.offline).toBe(false)
  })

  it('setScene / setLayer / setOffline update state', () => {
    useAppStore.getState().setScene('console')
    useAppStore.getState().setLayer('sat')
    useAppStore.getState().setOffline(true)
    const s = useAppStore.getState()
    expect(s.scene).toBe('console')
    expect(s.layer).toBe('sat')
    expect(s.offline).toBe(true)
  })
})
```

- [ ] **Step 4: Run the test (expect PASS) and typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/shared/store.test.ts
npm run typecheck
```
Expected: store tests pass; tsc clean.

- [ ] **Step 5: Vendor the glyph fonts**

Copy the legacy vendored glyphs into the app's public dir so MapLibre can fetch `{BASE_URL}assets/fonts/{fontstack}/{range}.pbf` (offline-capable, served, no file:// dependency):
```bash
mkdir -p "app/public/assets/fonts"
cp -r "assets/fonts/." "app/public/assets/fonts/"
```
Expected: `app/public/assets/fonts/<fontstack>/<range>.pbf` files present (mirrors legacy `assets/fonts`). Confirm at least the `Noto Sans Regular` stack ranges `0-255` and `256-511` exist:
```bash
ls "app/public/assets/fonts/Noto Sans Regular/" | head
```

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/src/shared/store.ts app/src/shared/store.test.ts app/public/assets/fonts
git commit -m "feat: map/globe deps, vendored glyphs, app scene store (Phase 1B)"
```

---

### Task 2: Map style, feature builders, and icon images (pure TS port)

**Files:**
- Create: `app/src/modules/console/map/features.ts`
- Create: `app/src/modules/console/map/icons.ts`
- Create: `app/src/modules/console/map/basemap.ts`
- Create: `app/src/modules/console/map/style.ts`
- Test: `app/src/modules/console/map/features.test.ts`
- Test: `app/src/modules/console/map/basemap.test.ts`
- Source refs: `assets/js/ui/map.js` lines 1-52 (rasters, attribution, vector tiles, glyph URL), 53-93 (dockFeatures/siteFeatures/coverageFeatures), 130-187 (icon builders), 514-860 (the style object), 966-993 (effectiveLayer/applyBasemap/applyPlaceLabelTheme).

**Interfaces:**
- Consumes: `@/modules/console/domain` (`DATA_DOCKS`, `DATA_SITES`, `DOCK_RANGE`, `SimRouter`, `GEO_UAE`, `GEO_WORLD`); `@/shared/store` (`MapLayer`, `Scene`).
- Produces:
  - `features.ts`: `dockFeatures()`, `siteFeatures()`, `coverageFeatures()` returning typed `FeatureCollection`s (transcribed from map.js:53-93).
  - `icons.ts`: `droneIconImage(): ImageData`, `trackIconImage(color: string): ImageData` (transcribed from map.js:135-187).
  - `basemap.ts`: `effectiveLayer(scene: Scene, layer: MapLayer): MapLayer` (globe → always 'sat', else layer); constants `RASTERS`, `RASTER_ATTRIBUTION`, `VECTOR_TILES`, `DARK_OVERLAY_IDS`, `OPERATIONAL_LAYER_IDS`, `SITE_STATUS_COLOR`; and `glyphsUrl(): string` = `${import.meta.env.BASE_URL}assets/fonts/{fontstack}/{range}.pbf` (replacing legacy `localGlyphsUrl`).
  - `style.ts`: `buildStyle(): StyleSpecification` — the full MapLibre style (sources + ~36 layers) transcribed from map.js:514-860, using `buildStyle`'s helpers for sources (rasters, `carto-streets` vector, `uae*`, `docks`/`sites`/`coverage` seeded via features.ts, live-empty `drones`/`drone-leaders`/`drone-trails`/`fx`/`missions-active`/`tracks`/`manual-wpts`/`wizard-preview`, `world`) and glyph URL from `glyphsUrl()`. Import `StyleSpecification` from `maplibre-gl`.

- [ ] **Step 1: Write `basemap.ts`**

Transcribe from map.js: the `RASTERS` (dark/light/sat/terrain `_nolabels`/Esri tile arrays, lines 4-11), `RASTER_ATTRIBUTION` (15-20), `VECTOR_TILES` (29-34), `DARK_OVERLAY_IDS` (37), `OPERATIONAL_LAYER_IDS` (101-109), `SITE_STATUS_COLOR` (114-118) verbatim, typed. Port `effectiveLayer` (966-971) as a PURE function `effectiveLayer(scene, layer)`. Add `glyphsUrl()` returning `import.meta.env.BASE_URL + 'assets/fonts/{fontstack}/{range}.pbf'` (the `{fontstack}/{range}` stay literal for MapLibre to substitute). No `any`.

- [ ] **Step 2: Write `features.ts`**

Port `dockFeatures` (map.js:53-59), `siteFeatures` (61-67), `coverageFeatures` (77-93) from `DATA_DOCKS`/`DATA_SITES`/`DOCK_RANGE`/`SimRouter.orbit`, returning `FeatureCollection` (from `geojson`). Transcribe the property shapes and geometry exactly. `coverageFeatures` uses `DOCK_RANGE.dockRangeKm`, `DOCK_RANGE.isUrbanDock`, and `SimRouter.orbit(coords, rangeKm*1000, 64)` exactly as the source.

- [ ] **Step 3: Write `icons.ts`**

Port `droneIconImage` (map.js:135-153) and `trackIconImage` (155-187) verbatim — the canvas drawing and `getImageData` return. Type return as `ImageData`. (These run in the browser at map-load; jsdom cannot exercise canvas 2d fully, so they are NOT unit tested here — browser-verified in Task 3.)

- [ ] **Step 4: Write `style.ts`**

Transcribe the entire `style` object from map.js:514-860 into `buildStyle(): StyleSpecification`. Rules:
- `sources`: build the raster sources from `RASTERS`/`RASTER_ATTRIBUTION`, the `carto-streets` vector source, the `uae`/`uae-roads`/`uae-places` geojson from `GEO_UAE`, `docks`/`sites`/`coverage` from `dockFeatures()`/`siteFeatures()`/`coverageFeatures()`, the live-empty geojson sources (`drones`, `drone-leaders`, `drone-trails`, `fx`, `missions-active`, `tracks`, `manual-wpts`, `wizard-preview`) with `emptyFC()`, and `world` from `GEO_WORLD`.
- `glyphs: glyphsUrl()`, `projection: { type: 'globe' }`, `version: 8`.
- `layers`: transcribe all ~36 layer definitions verbatim (bg, raster-dark/light/sat/terrain, dark-water/dark-greens, world-land-fill/line, coverage-fill/line/line-hi, uae-border-line, uae-roads, uae-places, missions-active-line/-spot, drone-trails, tracks-ping/-icons/-labels, docks-rings/-dots, sites-dots/-labels, fx, drone-leaders, drones-layer, drones-labels, manual-wpts-dots/-labels, wizard-preview-line/-dots/-labels). Keep every paint/layout/filter/minzoom exactly.
- Add `emptyFC()` local helper `(): FeatureCollection => ({ type: 'FeatureCollection', features: [] })`.
- Type the whole thing so `tsc` accepts it as `StyleSpecification`; if MapLibre's types reject an expression literal, prefer a precise cast on that one property over `any` (document why).

- [ ] **Step 5: Write `features.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { dockFeatures, siteFeatures, coverageFeatures } from './features'

describe('map feature builders', () => {
  it('dockFeatures emits one point per dock with id/state props', () => {
    const fc = dockFeatures()
    expect(fc.features.length).toBe(104)
    expect(fc.features[0].geometry.type).toBe('Point')
    expect(fc.features[0].properties?.state).toBe('ready')
  })
  it('siteFeatures emits one point per site with a status prop', () => {
    const fc = siteFeatures()
    expect(fc.features.length).toBe(19)
    expect(['installed', 'not-installed', 'replace']).toContain(fc.features[0].properties?.status)
  })
  it('coverageFeatures emits one closed polygon ring per dock and site', () => {
    const fc = coverageFeatures()
    expect(fc.features.length).toBe(104 + 19)
    const poly = fc.features[0]
    expect(poly.geometry.type).toBe('Polygon')
  })
})
```

- [ ] **Step 6: Write `basemap.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { effectiveLayer } from './basemap'

describe('effectiveLayer', () => {
  it('always shows satellite in the globe scene regardless of layer', () => {
    expect(effectiveLayer('globe', 'dark')).toBe('sat')
    expect(effectiveLayer('globe', 'terrain')).toBe('sat')
  })
  it('uses the operator layer in the console scene', () => {
    expect(effectiveLayer('console', 'dark')).toBe('dark')
    expect(effectiveLayer('console', 'light')).toBe('light')
  })
})
```

- [ ] **Step 7: Run tests + typecheck**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run test -- src/modules/console/map/features.test.ts src/modules/console/map/basemap.test.ts
npm run typecheck
```
Expected: feature + basemap tests pass; tsc clean (the style typechecks against `StyleSpecification`).

- [ ] **Step 8: Commit**

```bash
git add app/src/modules/console/map/
git commit -m "feat: port MapLibre style, feature builders, icons to TS (Phase 1B)"
```

---

### Task 3: `<MapView>` component, MapContext, basemap + offline behavior

**Files:**
- Create: `app/src/modules/console/map/MapContext.ts`
- Create: `app/src/modules/console/map/MapView.tsx`
- Create: `app/src/modules/console/map/useBasemap.ts`
- Create: `app/src/modules/console/map/useOffline.ts`
- Create: `app/src/modules/console/map/BasemapChip.tsx`
- Create: `app/src/modules/console/map/map.css`
- Source refs: map.js:862-938 (map construction, load handler, offline), 940-964 (basemap chip), 120-126 (operational layer visibility), 973-999 (applyBasemap/applyPlaceLabelTheme/setLayer).

**Interfaces:**
- Consumes: `style.ts` (`buildStyle`), `icons.ts`, `basemap.ts` (`effectiveLayer`, `DARK_OVERLAY_IDS`, `OPERATIONAL_LAYER_IDS`), `@/shared/store`.
- Produces:
  - `MapContext` — `React.Context<{ mapRef: React.MutableRefObject<maplibregl.Map | null>; ready: boolean }>`; hook `useMap()`.
  - `<MapView>` — constructs the single map, applies style, adds icon images on load, sets `ready`, renders the `#map` div, provides `MapContext`, and renders children (globe overlay / panels) once mounted. Imports `'maplibre-gl/dist/maplibre-gl.css'`.
  - `useBasemap()` — effect subscribing to store `scene`/`layer`/`offline`; applies raster visibility, dark overlays, place-label theme (transcribe `applyBasemap`/`applyPlaceLabelTheme`), and operational-layer visibility on scene change.
  - `useOffline()` — wires the map `error` handler (6 raster errors → `setOffline(true)`), the world-outline fallback layers, and the 15s recovery probe (transcribe map.js:911-937); syncs to store.

- [ ] **Step 1: Write `MapContext.ts`**

```ts
import { createContext, useContext } from 'react'
import type maplibregl from 'maplibre-gl'

export interface MapContextValue {
  mapRef: React.MutableRefObject<maplibregl.Map | null>
  ready: boolean
}

export const MapContext = createContext<MapContextValue | null>(null)

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMap must be used within <MapView>')
  return ctx
}
```

- [ ] **Step 2: Write `MapView.tsx`**

Create the component. On mount (a `useEffect` with an empty dep array): construct `new maplibregl.Map({ container, style: buildStyle(), center: [54.6, 24.3], zoom: 1.4, attributionControl: false, canvasContextAttributes: { antialias: true }, boxZoom: false })` (transcribe options from map.js:862-871), add the compact `AttributionControl` bottom-right, and on `'load'` add the three icon images (`drone-triangle`, `track-diamond`, `track-diamond-dim` via `icons.ts`) and set `ready`. Store the map in a ref. On cleanup call `map.remove()`. Provide `MapContext` with `{ mapRef, ready }`. Render `<div id="map" />` (styled full-bleed via `map.css`, transcribed from console.css `#map`) and, when `ready`, `props.children`. Import `'maplibre-gl/dist/maplibre-gl.css'` at the top.

Guard against React 18 StrictMode double-mount: if `mapRef.current` already exists, do not construct a second map.

- [ ] **Step 3: Write `useBasemap.ts`**

An effect hook (called by MapView once `ready`): subscribe to `useAppStore` (`scene`, `layer`, `offline`) and, on change (and once on ready), run the transcribed `applyBasemap` (raster visibility via `effectiveLayer`, `DARK_OVERLAY_IDS` visibility, `applyPlaceLabelTheme`) and `setOperationalLayersVisible(scene === 'console')` (transcribe map.js:120-126, 973-993). All imperative on `mapRef.current`; guard with `getLayer`.

- [ ] **Step 4: Write `useOffline.ts`**

An effect hook: attach the map `error` handler counting raster-source errors (≥6 → `useAppStore.getState().setOffline(true)`), toggle `world-land-fill`/`world-land-line` visibility with offline state, and run the 15s `setInterval` recovery probe loading a 1px CARTO tile (transcribe map.js:911-937). Clear the interval and remove the handler on cleanup. Drive the `#offline-chip` via a small piece of state or a store field (the chip itself is rendered in Task 5's console chrome; for 1B expose offline via the store which `BasemapChip`/an offline indicator can read).

- [ ] **Step 5: Write `BasemapChip.tsx` + `map.css`**

`BasemapChip`: a React component rendering "ACQUIRING BASEMAP", shown when raster tiles are loading in the console scene with the 300ms debounce (transcribe map.js:945-964 as a `useEffect` binding `sourcedataloading`/`idle` on the map). `map.css`: transcribe `#map`, `#basemap-loading`, and `.maplibregl-ctrl-attrib` styling from `console.css` (the relevant selectors only).

- [ ] **Step 6: Temporarily mount MapView at `/console` for verification**

Replace the `/console` placeholder route (from Phase 0) with `<MapView>` rendering `<BasemapChip/>` and a temporary layer-switch control (four buttons calling `setLayer`). Set the store `scene` to `'console'` initially (globe comes in Task 4) so the theater map shows. This is scaffolding refined in Task 5.

- [ ] **Step 7: Build + browser-verify**

Run (from `app/`, `export npm_config_script_shell=bash`):
```bash
npm run build
npm run dev
```
Open `http://localhost:5173/console`. Confirm: the UAE map renders with the dark basemap, 104 dock dots + 19 site dots + coverage rings visible, place labels themed, and the four layer buttons switch dark/light/sat/terrain (satellite + terrain load Esri imagery; light shows the light basemap; dark shows navy water + green overlays). Check the browser console for errors. Screenshot for the report. Stop the dev server.

- [ ] **Step 8: Run unit tests + typecheck + lint, then commit**

```bash
npm run test
npm run typecheck
npm run lint
git add app/src/modules/console/map/ app/src/App.tsx
git commit -m "feat: MapView component with basemap switching and offline fallback (Phase 1B)"
```

---

### Task 4: Globe scene, orbit-fit math, dive/exit, and overlay UI

**Files:**
- Create: `app/src/modules/console/globe/globeMath.ts`
- Create: `app/src/modules/console/globe/useGlobe.ts`
- Create: `app/src/modules/console/globe/GlobeOverlay.tsx`
- Create: `app/src/modules/console/globe/globe.css`
- Test: `app/src/modules/console/globe/globeMath.test.ts`
- Source refs: globe.js in full (constants 1-14, `shortestLngDelta` 34-39, `fitOrbitZoom`/`measureGlobeRadiusPx` 52-82, `onViewportResize` 84-93, `altKmFromZoom`/`fmtAlt` 97-106, `beaconVisible` 123-136, `rotateStep` 155-168, `tick` 171-196, beacon layers 198-222, dive/exit 259-287, `initGlobe` 298-326).

**Interfaces:**
- Consumes: `useMap()` (MapContext), `@/shared/store`.
- Produces:
  - `globeMath.ts` (pure, unit-tested): `shortestLngDelta(toLng, fromLng)`, `altKmFromZoom(zoom, orbitZoom, theaterZoom)`, `fmtAlt(km)`, and the `rotateStep` math as a pure `nextGlobeCenter(center, beacon, orbitLat, dt)` returning `{ lng, lat, settled }`. Transcribe constants (`ORBIT`, `THEATER`, `BEACON`, `DIVE_MS`, `DIVE_CURVE`, `ROTATE_DEG_PER_SEC`, `APPROACH_GAIN`, `APPROACH_MAX_DEG_PER_SEC`, `SETTLE_EPS_DEG`, `INTRO_LNG_OFFSET`, `GLOBE_FIT_FRACTION`, `TAG_HIT_PX`).
  - `useGlobe()` — runs the globe rAF tick (rotation homing, beacon ping, alt readout, canvas-size check), fits orbit zoom, adds beacon layers, wires pointer-pause + click-to-enter, and exposes `enterTheater()` / `exitToOrbit()` (transcribe globe.js dive/exit → set store `scene`). Uses `useMap().mapRef`.
  - `GlobeOverlay.tsx` — the `#globe-ui` overlay (brand, beacon tag positioned each frame, alt readout, ENTER THEATER button) as React, shown when `scene === 'globe'`. Transcribe copy + structure from `console.html`'s globe-ui block and globe.css.

- [ ] **Step 1: Write `globeMath.ts` (pure)**

Transcribe the pure math: `shortestLngDelta` (globe.js:34-39), `altKmFromZoom` (97-102, parameterized on orbit/theater zoom), `fmtAlt` (104-106), and `nextGlobeCenter(center, beacon, orbitLat, dt)` extracting the arithmetic of `rotateStep` (155-168) — returns the new center and a `settled` boolean. Export the constants block. No DOM, no map — pure numbers.

- [ ] **Step 2: Write the failing `globeMath.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { shortestLngDelta, altKmFromZoom, fmtAlt, nextGlobeCenter } from './globeMath'

describe('globe math', () => {
  it('shortestLngDelta wraps across the antimeridian', () => {
    expect(shortestLngDelta(10, 350)).toBe(20)
    expect(shortestLngDelta(350, 10)).toBe(-20)
  })
  it('altKmFromZoom interpolates orbit->theater on a log scale', () => {
    expect(altKmFromZoom(1.35, 1.35, 6.6)).toBeCloseTo(12742, 0)
    expect(altKmFromZoom(6.6, 1.35, 6.6)).toBeCloseTo(2, 0)
  })
  it('fmtAlt rounds above 100 and keeps one decimal below', () => {
    expect(fmtAlt(12742)).toBe('12742')
    expect(fmtAlt(2.4)).toBe('2.4')
  })
  it('nextGlobeCenter steps toward the beacon meridian and reports settled', () => {
    const near = nextGlobeCenter({ lng: 54.42, lat: 24.3 }, [54.4, 24.3], 24.3, 0.016)
    expect(near.settled).toBe(true)
    const far = nextGlobeCenter({ lng: 120, lat: 24.3 }, [54.4, 24.3], 24.3, 0.016)
    expect(far.settled).toBe(false)
    expect(far.lng).toBeLessThan(120)
  })
})
```

- [ ] **Step 3: Implement to green**

Ensure `globeMath.ts` makes the test pass. Run:
```bash
npm run test -- src/modules/console/globe/globeMath.test.ts
```
Expected: 4/4 pass.

- [ ] **Step 4: Write `useGlobe.ts`**

Port the imperative globe logic against `useMap().mapRef.current`: `measureGlobeRadiusPx`/`fitOrbitZoom` (need the live map's `project`/`getContainer`), `onViewportResize`, the beacon layers (`addBeaconLayers`), `beaconVisible`/`updateBeaconTag` (updates the overlay tag element via a ref/callback), `animateBeaconPing`, `updateAltReadout`, the `tick` rAF loop (using `nextGlobeCenter` for rotation), `wirePointerPause`, `wireClicks`, `enterTheater`/`exitToOrbit` (flyTo + on `moveend` set store `scene` and clear/settle). Start on mount, cancel rAF + remove listeners on cleanup. Boot: `map.resize()`, fit orbit zoom, `jumpTo` intro offset (globe.js:304-310). Expose `enterTheater`/`exitToOrbit` for the overlay button and the console EXIT control.

- [ ] **Step 5: Write `GlobeOverlay.tsx` + `globe.css`**

Render the overlay when `scene === 'globe'`: brand block, the beacon tag (`UNITED ARAB EMIRATES` / `GRID ONLINE · 104 DOCKS` / `CLICK TO ENTER THEATER`, positioned each frame by `useGlobe`), the alt readout, and the ENTER THEATER button (calls `enterTheater`). Transcribe copy from `console.html` globe-ui + the `.g-*` / `#globe-enter-btn` styles from `console.css`. The tag/alt DOM nodes are updated imperatively by `useGlobe` (pass refs), matching the legacy per-frame positioning.

- [ ] **Step 6: Wire globe into `<MapView>` and boot at `scene: 'globe'`**

Set the store default `scene` to `'globe'` (already the default). In the `/console` route, render `<MapView><GlobeOverlay/>…</MapView>` and call `useGlobe()` inside a child of MapView (so `useMap()` resolves). Remove Task 3's temporary "scene=console" override.

- [ ] **Step 7: Build + browser-verify the full dive**

Run (from `app/`, `export npm_config_script_shell=bash`): `npm run build && npm run dev`. Open `http://localhost:5173/console`. Confirm: boots into the satellite globe centered/circular, rotates the UAE to front-center and settles, the beacon tag appears, ENTER THEATER dives into the theater map, and the map then shows docks/sites/coverage on the dark basemap. Check console for errors; screenshot. Stop the server.

- [ ] **Step 8: Unit tests + typecheck + lint + commit**

```bash
npm run test
npm run typecheck
npm run lint
git add app/src/modules/console/globe/ app/src/App.tsx
git commit -m "feat: React orbital globe with dive-to-theater and scene store (Phase 1B)"
```

---

### Task 5: Console chrome scaffold, ping/FX driver, route integration

**Files:**
- Create: `app/src/modules/console/Console.tsx`
- Create: `app/src/modules/console/map/usePingDriver.ts`
- Create: `app/src/modules/console/OfflineChip.tsx`
- Modify: `app/src/App.tsx` (mount `<Console>` at `/console`)
- Test: `app/src/modules/console/Console.test.tsx` (jsdom — renders the overlay chrome without the WebGL map)
- Source refs: map.js:458-512 (ping + fx driver), 918-937 (offline chip), console.html topbar skeleton (for the minimal chrome placeholder).

**Interfaces:**
- Consumes: `<MapView>`, `<GlobeOverlay>`, `useGlobe`, `useBasemap`, `useOffline`, `usePingDriver`, `@/shared/store`.
- Produces: `<Console>` — the composed console route: `<MapView>` wrapping the globe overlay, the basemap/offline/ping hooks, the basemap + offline chips, and a minimal topbar placeholder with the four layer buttons and an EXIT-to-orbit button (full topbar/panels are Phase 1D). `usePingDriver()` — the paint-only dock-ring ping + FX-pulse rAF driver (transcribe map.js:461-512), running in the console scene.

- [ ] **Step 1: Write `usePingDriver.ts`**

Port `startPingDriver` (map.js:461-512): a single rAF loop (started on ready, cancelled on cleanup) that, when `scene === 'console'`, animates `docks-rings` and `tracks-ping` paint properties and rebuilds the `fx` source from a module-scoped `fxPulses` array (empty in 1B — no launches yet, but the plumbing is in place for 1C). Read scene via `useAppStore.getState()`. Guard all map/layer access.

- [ ] **Step 2: Write `OfflineChip.tsx`**

A small React chip reading `offline` from the store, rendering the "OFFLINE · CACHED VIEW" indicator (transcribe copy/behavior from the legacy `#offline-chip` usage) shown only when offline.

- [ ] **Step 3: Write `Console.tsx`**

Compose: `<MapView>` containing a child component that calls `useGlobe()`, `useBasemap()`, `useOffline()`, `usePingDriver()`, and renders `<GlobeOverlay/>`, `<BasemapChip/>`, `<OfflineChip/>`, and a minimal console chrome (a placeholder topbar with: the four basemap buttons calling `setLayer`, and an EXIT button calling `exitToOrbit`, shown only when `scene === 'console'`). Keep the chrome intentionally minimal — Phase 1D replaces it with the real topbar/sidebar/panels.

- [ ] **Step 4: Write `Console.test.tsx` (jsdom)**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useAppStore } from '@/shared/store'
import { GlobeOverlay } from './globe/GlobeOverlay'

afterEach(cleanup)

describe('globe overlay chrome', () => {
  it('shows the ENTER THEATER control in the globe scene', () => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    render(<GlobeOverlay onEnter={() => {}} tagRef={{ current: null }} altRef={{ current: null }} />)
    expect(screen.getByRole('button', { name: /enter theater/i })).toBeTruthy()
  })
})
```
(Adjust props to `GlobeOverlay`'s actual signature. This verifies the overlay React tree renders without a WebGL map — the map itself is browser-verified, not jsdom.)

- [ ] **Step 5: Wire `/console` route**

In `app/src/App.tsx`, replace the `/console` route's element with `<Console />`. Leave the other placeholder routes (`/planner`, `/telemetry`, `/compliance`) unchanged.

- [ ] **Step 6: Full build + browser integration verify**

Run (from `app/`, `export npm_config_script_shell=bash`): `npm run build && npm run dev`. Then, from the landing (`http://localhost:5173/`), click Simulation → `/console`: confirm the whole flow — satellite globe intro → homing rotation → ENTER THEATER → theater map with docks/sites/coverage → layer switch (all four) → EXIT returns to orbit → re-enter works. Confirm no console errors. Also verify the production build path with `npm run preview` at `http://localhost:4173/e-Sentinel/console` (the base-path route resolves). Screenshot both. Stop servers.

- [ ] **Step 7: Full verify + commit**

```bash
npm run test
npm run typecheck
npm run lint
npm run build
git add app/src/modules/console/ app/src/App.tsx
git commit -m "feat: console route with globe->theater flow and ping/FX driver (Phase 1B)"
```

---

## Self-Review

**Spec coverage (spec §8.1 Phase 1, the map/globe portion; §3 shared map wrapper):**
- Shared MapLibre wrapper component → `<MapView>` (Task 3), map instance in a ref, exposed via `MapContext` for globe now and panels later.
- Orbital globe entry + dive → Task 4 (`useGlobe` + `GlobeOverlay`), faithful port of globe.js.
- Basemap switching + offline fallback → Task 3 (`useBasemap`/`useOffline`).
- All static layers (geo, docks, sites, coverage) from the ported domain → Task 2 (`style.ts` + `features.ts`).
- Scene state via a store (Zustand per spec §3) → Task 1 (`useAppStore`), replacing `EC2.onSceneChange`.
- Repo layout `app/src/modules/console/` → all files under `app/src/modules/console/{map,globe}` + `Console.tsx`, matching spec §3.
- Legacy stays live → only `app/` touched; `assets/`, `console.html`, `deploy.yml` untouched.

**Explicitly out of Phase 1B scope (later sub-plans):** live engine binding / `updateLiveLayers` feeding drones-missions-tracks and the sim tick loop (Phase 1C); the real topbar/sidebar/right-panel/ticker and selection (Phase 1D); manual control / mission wizard / debrief / media (Phase 1E); the Pages deploy flip and legacy deletion (Phase 1F). Phase 1B renders the map surface with static data + the globe intro; live layers exist in the style with empty sources awaiting 1C.

**Placeholder scan:** No TBD/TODO. Transcription tasks reference exact legacy line ranges + rules rather than re-pasting the 340-line style or 327-line globe; the new React scaffolding (store, context, component shells, pure math) is given in full. Test code is concrete.

**Type consistency:** `Scene`/`MapLayer` defined in `store.ts` (Task 1), consumed by `basemap.ts`/`effectiveLayer` (Task 2), `useBasemap` (Task 3), and `globeMath`/`useGlobe` (Task 4). `MapContextValue.mapRef` type (`maplibregl.Map | null`) consistent between `MapContext.ts` (Task 3) and `useGlobe`/`usePingDriver` consumers (Tasks 4-5). `buildStyle(): StyleSpecification` (Task 2) consumed by `MapView` (Task 3). `dockFeatures`/`siteFeatures`/`coverageFeatures` names consistent between `features.ts` (Task 2), `style.ts` (Task 2), and `features.test.ts`.
