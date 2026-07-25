# Deployment Planner (AOI, Docks, Coverage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 02, the Deployment Planner: define a customer AOI by drawing or importing KML/KMZ, place docks manually or via deterministic auto-placement, and see live coverage %, overlap % and uncovered gaps.

**Architecture:** A new `React.lazy` route `/planner` reusing the console's `MapView`/`MapContext`/`mapLifecycle` shell. All geometry lives in a pure, framework-free `planner/domain/` layer (no map, no React) so coverage and placement are unit-testable and auto-placement is deterministic. Plan state lives in a planner-local Zustand store; panels re-render normally, and only GeoJSON pushes to map sources are imperative.

**Tech Stack:** React 18 + TypeScript (strict), Vite 6, Zustand 5, MapLibre GL 5, terra-draw 1.32 + its MapLibre adapter, cherry-picked `@turf/*` 7.3.5, `@tmcw/togeojson` 7, `fflate` 0.8, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-07-25-planner-aoi-docks-coverage-design.md`

## Global Constraints

- TypeScript strict. **No `any`.** Type-only casts must carry a comment explaining why.
- `npm run lint` runs `eslint . --max-warnings 0` — zero warnings, not just zero errors.
- The pre-commit hook runs eslint + prettier but **NOT** typecheck. Run `npm run typecheck` yourself before every commit.
- Run npm from **Git Bash**, not PowerShell, with `export npm_config_script_shell=bash`. Before `git commit`, `export PATHEXT=";$PATHEXT"` so the hook can spawn eslint/prettier. The repo path contains `&`, which breaks npm's default cmd.exe script-shell.
- **Dev URL is `http://localhost:5173/planner`** — NOT `/e-Sentinel/planner`. Only the production build and `npm run preview` (port 4173) use the `/e-Sentinel/` base.
- The filesystem is **case-insensitive**. Never create two files in one directory whose names differ only by case. Pure model files are `camelCase.ts`; React components are `PascalCase.tsx`.
- Any map access from an effect **cleanup** must use `isMapUsable(map)` from `@/modules/console/map/mapLifecycle`. React tears a deleted subtree down parent-first, so `MapView` has already called `map.remove()` by then.
- UI copy: **no em dashes**. Mono micro-labels are 9.5px / .22em uppercase. Red `#ff5a5a` / `#BC0000` is reserved for brand and alerts only.
- Never port `escapeHtml` — JSX escapes by construction.
- turf 7 changed `union` / `intersect` / `difference` to take a single `FeatureCollection`, not two positional features. Most online examples still show the v6 signature.
- Vitest defaults to the `node` environment. Tests needing a DOM start with the pragma `// @vitest-environment jsdom` on line 1.

**Deliberate deferral:** `MapView` and friends stay in `@/modules/console/map/`; the planner imports them across module boundaries via the `@` alias. Moving the generic map shell to `@/shared/map/` is the cleaner boundary, but the console shipped and was verified three commits ago and this would be pure import churn across 146 files for no behavior change. Revisit if a third consumer appears.

---

### Task 1: Split the base cartography out of `style.ts`

`buildStyle()` currently returns the base cartography (rasters, carto-streets vector overlay, UAE borders/roads/places, world landmass) **and** the console's sim sources/layers (docks, sites, coverage, drones, trails, tracks, missions, fx, wizard-preview, manual-wpts) in one object. The planner needs the first half and none of the second. Split them so both modules build on one cartography definition.

The refactor is safe because it is provably output-preserving: the test asserts `buildStyle()` still produces exactly the same source ids and layer id sequence.

**Files:**
- Modify: `app/src/modules/console/map/style.ts`
- Test: `app/src/modules/console/map/style.test.ts` (exists — add to it)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildBaseStyle(): StyleSpecification` — cartography only. `buildStyle(): StyleSpecification` — unchanged public behavior, now composed from `buildBaseStyle()`.

- [ ] **Step 1: Capture the current output as a golden fixture**

Add to `app/src/modules/console/map/style.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildStyle } from './style'

describe('buildStyle composition', () => {
  it('still produces the same layer id sequence after the base/console split', () => {
    const style = buildStyle()
    const layerIds = style.layers.map((l) => l.id)
    // 34 layers, exact order matters: MapLibre paints in array order.
    expect(layerIds).toMatchSnapshot()
    expect(Object.keys(style.sources).sort()).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run it to record the snapshot BEFORE any refactor**

```bash
cd app && npx vitest run src/modules/console/map/style.test.ts -u
```

Expected: PASS, and `src/modules/console/map/__snapshots__/style.test.ts.snap` is created. Commit this snapshot now so the refactor is measured against it.

```bash
git add src/modules/console/map/style.test.ts src/modules/console/map/__snapshots__/
git commit -m "test: snapshot buildStyle layer order before the cartography split"
```

- [ ] **Step 3: Extract `buildBaseStyle()`**

In `style.ts`, split the single returned object. `buildBaseStyle()` returns `version`, `glyphs`, `projection`, the raster sources, `carto-streets`, `uae`, `uae-roads`, `uae-places`, the world landmass source, and **only** the layers rendering those. `buildStyle()` then spreads it and appends the console's sim sources and layers:

```ts
// The base cartography shared by every module that shows a map: rasters,
// the carto-streets vector overlay, UAE borders/roads/places and the world
// landmass fallback. Deliberately contains NO simulation state, so the
// planner (which has no sim) can build on it without inheriting empty
// drone/track/wizard layers it would never populate.
export function buildBaseStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: glyphsUrl(),
    projection: { type: 'globe' },
    sources: {
      ...buildRasterSources(),
      'carto-streets': { /* unchanged */ },
      uae: { type: 'geojson', data: GEO_UAE.borders },
      'uae-roads': { type: 'geojson', data: GEO_UAE.roads },
      'uae-places': { type: 'geojson', data: GEO_UAE.places },
      world: { /* unchanged world landmass source */ },
    },
    layers: [ /* the cartography layers, in their existing relative order */ ],
  }
}

export function buildStyle(): StyleSpecification {
  const base = buildBaseStyle()
  return {
    ...base,
    sources: {
      ...base.sources,
      docks: { type: 'geojson', data: dockFeatures() },
      coverage: { type: 'geojson', data: coverageFeatures() },
      sites: { type: 'geojson', data: siteFeatures() },
      drones: { type: 'geojson', data: emptyFC() },
      // ...every remaining sim source, unchanged
    },
    layers: [...base.layers, /* every console sim layer, unchanged order */],
  }
}
```

Move each source and layer verbatim. Change no paint, layout, filter, minzoom or literal.

- [ ] **Step 4: Verify the output is byte-identical**

```bash
cd app && npx vitest run src/modules/console/map/style.test.ts
```

Expected: PASS with **no snapshot update**. A snapshot mismatch means a layer moved or was dropped — fix the split, do not update the snapshot.

- [ ] **Step 5: Full console suite still green**

```bash
cd app && npx vitest run && npm run typecheck && npm run lint
```

Expected: 233 tests pass, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/console/map/style.ts
git commit -m "refactor: split buildBaseStyle out of buildStyle for planner reuse"
```

---

### Task 2: Parameterize `MapView` and add the `/planner` route shell

`MapView` hardcodes `buildStyle()`, `UAE_CENTER` and `zoom: 1.4` (the globe entry camera). The planner needs the base style and a normal working zoom. Add optional props whose defaults reproduce today's behavior exactly, then register the route.

**Files:**
- Modify: `app/src/modules/console/map/MapView.tsx`
- Modify: `app/src/App.tsx`
- Create: `app/src/modules/planner/ui/Planner.tsx`
- Test: `app/src/modules/console/map/MapView.props.test.tsx`

**Interfaces:**
- Consumes: `buildBaseStyle` (Task 1).
- Produces: `MapViewProps { children?, initialCenter?, initialZoom?, styleSpec? }`. `Planner` default export, the `/planner` route element.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/console/map/MapView.props.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { MAP_VIEW_DEFAULTS } from './MapView'

describe('MapView defaults', () => {
  it('keeps the console globe-entry camera as the default', () => {
    // Guards against a planner-driven refactor silently changing the camera
    // the console boots at (zoom 1.4 is the orbital globe start).
    expect(MAP_VIEW_DEFAULTS.center).toEqual([54.6, 24.3])
    expect(MAP_VIEW_DEFAULTS.zoom).toBe(1.4)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/console/map/MapView.props.test.tsx
```

Expected: FAIL — `MAP_VIEW_DEFAULTS` is not exported.

- [ ] **Step 3: Add the props**

In `MapView.tsx`:

```tsx
import type { StyleSpecification } from 'maplibre-gl'

const UAE_CENTER: [number, number] = [54.6, 24.3]

// Exported so a test can pin them: these defaults ARE the console's globe
// entry camera, and the planner passing its own must not disturb them.
export const MAP_VIEW_DEFAULTS = { center: UAE_CENTER, zoom: 1.4 } as const

export interface MapViewProps {
  children?: ReactNode
  initialCenter?: [number, number]
  initialZoom?: number
  styleSpec?: StyleSpecification
}

export default function MapView({
  children,
  initialCenter = MAP_VIEW_DEFAULTS.center,
  initialZoom = MAP_VIEW_DEFAULTS.zoom,
  styleSpec,
}: MapViewProps) {
  // ...existing refs and state unchanged...

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleSpec ?? buildStyle(),
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      boxZoom: false,
    })
    // ...rest of the effect body unchanged, including the cleanup...
    // eslint-disable-next-line react-hooks/exhaustive-deps -- construction is
    // intentionally once-per-mount; the props are read as initial values only,
    // matching MapLibre's own constructor semantics. Re-running on a prop
    // change would build a second map.
  }, [])
```

- [ ] **Step 4: Run the test**

```bash
cd app && npx vitest run src/modules/console/map/MapView.props.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add the planner route shell**

Create `app/src/modules/planner/ui/Planner.tsx`:

```tsx
import MapView from '@/modules/console/map/MapView'
import { buildBaseStyle } from '@/modules/console/map/style'

// Working camera for the planner: the whole UAE in frame at a zoom you can
// actually place docks at, rather than the console's orbital globe entry.
const PLANNER_CENTER: [number, number] = [54.6, 24.3]
const PLANNER_ZOOM = 6.4

export default function Planner() {
  return (
    <div className="planner-root">
      <MapView initialCenter={PLANNER_CENTER} initialZoom={PLANNER_ZOOM} styleSpec={buildBaseStyle()} />
    </div>
  )
}
```

In `App.tsx`, add the lazy import beside the console's and swap the route:

```tsx
const Planner = lazy(() => import('./modules/planner/ui/Planner'))
// ...
<Route path="/planner" element={<Planner />} />
```

- [ ] **Step 6: Verify in a real browser**

```bash
cd app && npm run dev
```

Open `http://localhost:5173/planner` via Playwright MCP. Expected: the UAE map renders, zero console errors. Navigate to `/` and back to `/planner` twice — still zero errors.

- [ ] **Step 7: Commit**

```bash
cd app && npm run typecheck && npm run lint && npx vitest run
git add src/modules/console/map/MapView.tsx src/modules/console/map/MapView.props.test.tsx src/App.tsx src/modules/planner/
git commit -m "feat: parameterize MapView camera and style, add the /planner route shell"
```

---

### Task 3: terra-draw spike — AOI drawing with clean teardown

**This is the risk task and it must land before anything is built on top of it.** The failure mode being de-risked is the Phase 1F parent-first teardown crash: `MapView` calls `map.remove()` before child hook cleanups run, so terra-draw's own teardown lands on a dead map.

**Files:**
- Modify: `app/package.json` (dependencies)
- Create: `app/src/modules/planner/map/useAoiDraw.ts`
- Test: `app/src/modules/planner/map/useAoiDraw.test.ts`

**Interfaces:**
- Consumes: `isMapUsable` from `@/modules/console/map/mapLifecycle`.
- Produces: `useAoiDraw(mapRef, ready, opts: { onFinish(geometry: GeoJSON.Polygon): void })` returning `{ setMode(mode: AoiDrawMode): void; cancel(): void }` where `type AoiDrawMode = 'idle' | 'polygon' | 'rectangle' | 'circle'`.

- [ ] **Step 1: Install the dependencies**

```bash
cd app && export npm_config_script_shell=bash && npm install terra-draw@1.32.2 terra-draw-maplibre-gl-adapter@1.4.1
```

- [ ] **Step 2: Write the failing teardown test**

Create `app/src/modules/planner/map/useAoiDraw.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { teardownDraw } from './useAoiDraw'

describe('teardownDraw', () => {
  it('stops the draw instance when the map is still alive', () => {
    const stop = vi.fn()
    const map = { style: {} } as unknown as maplibregl.Map
    teardownDraw({ stop } as never, map)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does NOT touch the draw instance once the map has been removed', () => {
    // MapView nulls mapRef and calls map.remove() BEFORE this cleanup runs on
    // route navigation (React tears deleted subtrees down parent-first), so
    // stopping terra-draw here would dereference a torn-down Style.
    const stop = vi.fn()
    const removedMap = {} as unknown as maplibregl.Map // no .style => removed
    teardownDraw({ stop } as never, removedMap)
    expect(stop).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no draw instance', () => {
    expect(() => teardownDraw(null, { style: {} } as never)).not.toThrow()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/map/useAoiDraw.test.ts
```

Expected: FAIL — `teardownDraw` is not exported.

- [ ] **Step 4: Implement the hook**

Create `app/src/modules/planner/map/useAoiDraw.ts`:

```ts
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'

export type AoiDrawMode = 'idle' | 'polygon' | 'rectangle' | 'circle'

interface StoppableDraw {
  stop(): void
}

// Extracted so the teardown ordering rule is unit-testable without a real
// map. See the Phase 1F mapLifecycle note: on route navigation MapView's
// cleanup (map.remove()) runs BEFORE this one, so the map may already be dead.
export function teardownDraw(draw: StoppableDraw | null, map: maplibregl.Map | null): void {
  if (!draw) return
  if (!isMapUsable(map)) return
  draw.stop()
}

export interface AoiDrawControls {
  setMode(mode: AoiDrawMode): void
  cancel(): void
}

export function useAoiDraw(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  opts: { onFinish(geometry: GeoJSON.Polygon): void },
): AoiDrawControls {
  const drawRef = useRef<TerraDraw | null>(null)
  const onFinishRef = useRef(opts.onFinish)
  onFinishRef.current = opts.onFinish

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || drawRef.current) return

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawPolygonMode(), new TerraDrawRectangleMode(), new TerraDrawCircleMode()],
    })
    draw.start()
    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id)
      if (feature && feature.geometry.type === 'Polygon') {
        onFinishRef.current(feature.geometry)
        draw.clear()
      }
    })
    drawRef.current = draw

    return () => {
      teardownDraw(drawRef.current, mapRef.current)
      drawRef.current = null
    }
  }, [mapRef, ready])

  return {
    setMode(mode) {
      const draw = drawRef.current
      if (!draw) return
      draw.setMode(mode === 'idle' ? 'static' : mode)
    },
    cancel() {
      const draw = drawRef.current
      if (!draw) return
      draw.clear()
      draw.setMode('static')
    },
  }
}
```

- [ ] **Step 5: Run the test**

```bash
cd app && npx vitest run src/modules/planner/map/useAoiDraw.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 6: Wire it into `Planner.tsx` temporarily and verify in a browser**

Add a temporary `DRAW POLYGON` button that calls `setMode('polygon')` and logs the finished geometry. Then, via Playwright MCP at `http://localhost:5173/planner`:

1. Click DRAW POLYGON, click 4 points on the map, double-click to close. Expected: polygon renders, geometry logged.
2. Navigate to `/` and back. Expected: **zero console errors**.
3. Repeat the draw. Expected: still works.

This is the gate. If step 2 produces `Cannot read properties of undefined`, the teardown is wrong — fix it here before proceeding.

- [ ] **Step 7: Commit**

```bash
cd app && npm run typecheck && npm run lint && npx vitest run
git add package.json package-lock.json src/modules/planner/
git commit -m "feat: terra-draw AOI drawing with map-teardown-safe cleanup"
```

---

### Task 4: Domain types and the plan store

**Files:**
- Create: `app/src/modules/planner/domain/types.ts`
- Create: `app/src/modules/planner/domain/plan.ts`
- Create: `app/src/modules/planner/store/planStore.ts`
- Test: `app/src/modules/planner/domain/plan.test.ts`

**Interfaces:**
- Produces: every type in spec §5, plus `createPlan(opts?): DeploymentPlan`, `addAoi(plan, aoi): DeploymentPlan`, `addDock(plan, dock): DeploymentPlan`, `updateDock(plan, id, patch): DeploymentPlan`, `removeDock(plan, id): DeploymentPlan`, `removeAoi(plan, id): DeploymentPlan`. All pure, all bump `rev`. Store: `usePlanStore` with `{ plan, coverage, selection, setPlan, select, ... }`.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/domain/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createPlan, addDock, updateDock, removeDock } from './plan'
import type { PlannedDock } from './types'

const dock = (id: string): PlannedDock => ({
  id,
  name: id,
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
})

describe('plan mutations', () => {
  it('creates an empty plan at rev 0', () => {
    const p = createPlan()
    expect(p.aois).toEqual([])
    expect(p.docks).toEqual([])
    expect(p.rev).toBe(0)
    expect(p.schemaVersion).toBe(1)
  })

  it('bumps rev on every mutation', () => {
    const p0 = createPlan()
    const p1 = addDock(p0, dock('d1'))
    const p2 = addDock(p1, dock('d2'))
    expect(p1.rev).toBe(1)
    expect(p2.rev).toBe(2)
    expect(p2.docks).toHaveLength(2)
  })

  it('does not mutate the input plan', () => {
    const p0 = createPlan()
    addDock(p0, dock('d1'))
    expect(p0.docks).toHaveLength(0)
    expect(p0.rev).toBe(0)
  })

  it('patches a dock without touching its neighbours', () => {
    const p = addDock(addDock(createPlan(), dock('d1')), dock('d2'))
    const out = updateDock(p, 'd1', { radiusKmOverride: 7 })
    expect(out.docks[0].radiusKmOverride).toBe(7)
    expect(out.docks[1].radiusKmOverride).toBeUndefined()
  })

  it('removes a dock by id', () => {
    const p = addDock(addDock(createPlan(), dock('d1')), dock('d2'))
    expect(removeDock(p, 'd1').docks.map((d) => d.id)).toEqual(['d2'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/domain/plan.test.ts
```

Expected: FAIL — cannot resolve `./plan`.

- [ ] **Step 3: Write `types.ts`**

Transcribe spec §5 verbatim, adding the catalog id unions:

```ts
export type DockModelId = 'DOCK3' | 'DOCK2'
export type DroneModelId = 'M4TD' | 'M4D' | 'M350'

export interface Aoi {
  id: string
  name: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  source: 'drawn' | 'kml' | 'kmz'
  valid: boolean
  simplifiedFrom?: number
}

export interface PlannedDock {
  id: string
  name: string
  position: [lon: number, lat: number]
  dockModel: DockModelId
  droneModel: DroneModelId
  environment: 'urban' | 'rural'
  radiusKmOverride?: number
  source: 'manual' | 'auto'
}

export interface CoverageParams {
  targetOverlapPct: number
  requiredCoveragePct: number
}

export interface DeploymentPlan {
  id: string
  name: string
  customer: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
  aois: Aoi[]
  docks: PlannedDock[]
  params: CoverageParams
  rev: number
}

export type CoverageResult =
  | { ok: false; reason: 'no-aoi' | 'no-docks' | 'degenerate' }
  | {
      ok: true
      aoiKm2: number
      coveragePct: number
      overlapPct: number
      uncovered: GeoJSON.MultiPolygon
      gapCount: number
      perDock: { dockId: string; grossContributionKm2: number }[]
    }
```

- [ ] **Step 4: Write `plan.ts`**

```ts
import type { Aoi, DeploymentPlan, PlannedDock } from './types'

export const PLAN_SCHEMA_VERSION = 1
export const DEFAULT_PARAMS = { targetOverlapPct: 20, requiredCoveragePct: 95 }

// Monotonic counter, NOT Math.random or Date.now: ids must be reproducible
// so auto-placement output can be asserted byte-for-byte in tests.
let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}
export function resetIdsForTest(): void {
  seq = 0
}

function bump(plan: DeploymentPlan, patch: Partial<DeploymentPlan>): DeploymentPlan {
  return { ...plan, ...patch, rev: plan.rev + 1, updatedAt: new Date().toISOString() }
}

export function createPlan(opts?: { name?: string; customer?: string; now?: string }): DeploymentPlan {
  const now = opts?.now ?? new Date().toISOString()
  return {
    id: nextId('plan'),
    name: opts?.name ?? 'UNTITLED PLAN',
    customer: opts?.customer ?? '',
    createdAt: now,
    updatedAt: now,
    schemaVersion: PLAN_SCHEMA_VERSION,
    aois: [],
    docks: [],
    params: { ...DEFAULT_PARAMS },
    rev: 0,
  }
}

export const addAoi = (p: DeploymentPlan, aoi: Aoi) => bump(p, { aois: [...p.aois, aoi] })
export const removeAoi = (p: DeploymentPlan, id: string) =>
  bump(p, { aois: p.aois.filter((a) => a.id !== id) })
export const addDock = (p: DeploymentPlan, dock: PlannedDock) => bump(p, { docks: [...p.docks, dock] })
export const removeDock = (p: DeploymentPlan, id: string) =>
  bump(p, { docks: p.docks.filter((d) => d.id !== id) })
export const updateDock = (p: DeploymentPlan, id: string, patch: Partial<PlannedDock>) =>
  bump(p, { docks: p.docks.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
export const setDocks = (p: DeploymentPlan, docks: PlannedDock[]) => bump(p, { docks })
export const setParams = (p: DeploymentPlan, params: DeploymentPlan['params']) => bump(p, { params })
```

- [ ] **Step 5: Run the test**

```bash
cd app && npx vitest run src/modules/planner/domain/plan.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 6: Write the store**

Create `app/src/modules/planner/store/planStore.ts`:

```ts
import { create } from 'zustand'
import type { CoverageResult, DeploymentPlan } from '../domain/types'
import { createPlan } from '../domain/plan'

export type PlannerSelection = { type: 'aoi' | 'dock'; id: string } | null

interface PlanState {
  plan: DeploymentPlan
  coverage: CoverageResult
  selection: PlannerSelection
  setPlan(next: DeploymentPlan): void
  setCoverage(next: CoverageResult): void
  select(sel: PlannerSelection): void
}

// A planner-local store, deliberately NOT a slice of shared/store.ts:
// nothing outside /planner reads a plan, and the plan mutates on every
// interaction. Keeping it separate stops the global store growing a large
// feature-specific surface.
export const usePlanStore = create<PlanState>((set) => ({
  plan: createPlan(),
  coverage: { ok: false, reason: 'no-aoi' },
  selection: null,
  setPlan: (plan) => set({ plan }),
  setCoverage: (coverage) => set({ coverage }),
  select: (selection) => set({ selection }),
}))
```

- [ ] **Step 7: Commit**

```bash
cd app && npm run typecheck && npm run lint && npx vitest run
git add src/modules/planner/
git commit -m "feat: planner domain types, pure plan mutations and plan store"
```

---

### Task 5: Dock/drone catalog and radius derivation

**Files:**
- Create: `app/src/modules/planner/domain/catalog.ts`
- Test: `app/src/modules/planner/domain/catalog.test.ts`

**Interfaces:**
- Consumes: `PlannedDock`, `DroneModelId`, `DockModelId` (Task 4); `DOCK_RANGE` from `@/modules/console/domain`.
- Produces: `DRONES: Record<DroneModelId, DroneSpec>`, `DOCK_MODELS: Record<DockModelId, DockSpec>`, `effectiveRadius(dock: PlannedDock): RadiusBreakdown` where `RadiusBreakdown = { radiusKm: number; enduranceKm: number; capKm: number; bound: 'endurance' | 'cap' | 'override' }`, and the exported pure helper `radiusFromTerms(terms: { enduranceKm: number; capKm: number; override: number | undefined }): RadiusBreakdown` that `effectiveRadius` delegates the min()/override decision to.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/domain/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { effectiveRadius, radiusFromTerms, DRONES } from './catalog'
import type { PlannedDock } from './types'

const dock = (patch: Partial<PlannedDock> = {}): PlannedDock => ({
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
  ...patch,
})

describe('effectiveRadius', () => {
  it('derives endurance range from cruise, endurance, reserve and on-task time', () => {
    // M4TD: 54 kph, 48 min, 30% reserve, 5 min on task
    // usable = 48 * 0.7 = 33.6; out-leg = (33.6 - 5) / 2 = 14.3 min
    // km = 54/60 * 14.3 = 12.87
    const r = effectiveRadius(dock())
    expect(r.enduranceKm).toBeCloseTo(12.87, 2)
  })

  it('lets the environment cap bind when it is smaller (urban 3km)', () => {
    const r = effectiveRadius(dock({ environment: 'urban' }))
    expect(r.capKm).toBe(3)
    expect(r.radiusKm).toBe(3)
    expect(r.bound).toBe('cap')
  })

  it('uses the rural cap of 5km for rural docks', () => {
    const r = effectiveRadius(dock({ environment: 'rural' }))
    expect(r.capKm).toBe(5)
    expect(r.radiusKm).toBe(5)
    expect(r.bound).toBe('cap')
  })

  it('lets a per-dock override win over both', () => {
    const r = effectiveRadius(dock({ radiusKmOverride: 8 }))
    expect(r.radiusKm).toBe(8)
    expect(r.bound).toBe('override')
    // The derivation is still reported so the inspector can show the headroom.
    expect(r.enduranceKm).toBeCloseTo(12.87, 2)
    expect(r.capKm).toBe(3)
  })

  it('reports endurance as binding when endurance is below the cap', () => {
    // No catalogued airframe is endurance-bound (all three exceed both the 3km
    // and 5km caps), so this branch is exercised through the exported pure
    // helper rather than a catalog entry. Testing it matters: if real datasheet
    // figures land lower than these provisional ones, this becomes the live
    // branch and it must already be correct.
    const r = radiusFromTerms({ enduranceKm: 2, capKm: 5, override: undefined })
    expect(r.radiusKm).toBe(2)
    expect(r.bound).toBe('endurance')
  })

  it('every catalogued drone carries all four derivation terms', () => {
    for (const spec of Object.values(DRONES)) {
      expect(spec.cruiseKph).toBeGreaterThan(0)
      expect(spec.enduranceMin).toBeGreaterThan(0)
      expect(spec.reservePct).toBeGreaterThan(0)
      expect(spec.onTaskMin).toBeGreaterThanOrEqual(0)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/domain/catalog.test.ts
```

Expected: FAIL — cannot resolve `./catalog`.

- [ ] **Step 3: Implement**

Create `app/src/modules/planner/domain/catalog.ts`:

```ts
import { DOCK_RANGE } from '@/modules/console/domain'
import type { DockModelId, DroneModelId, PlannedDock } from './types'

export interface DroneSpec {
  id: DroneModelId
  label: string
  cruiseKph: number
  enduranceMin: number
  reservePct: number
  onTaskMin: number
}

export interface DockSpec {
  id: DockModelId
  label: string
  drones: DroneModelId[]
}

// PROVISIONAL FIGURES. Drawn from public DJI marketing material for the three
// airframes the simulation already uses; NOT verified against a datasheet.
// The simulation carries no per-drone endurance data of its own (its speedMs
// values are per mission type, not per airframe), so these are new numbers.
// Replacing them is intended to be a one-file change: nothing outside this
// module hardcodes a drone figure.
export const DRONES: Record<DroneModelId, DroneSpec> = {
  M4TD: { id: 'M4TD', label: 'Matrice 4TD', cruiseKph: 54, enduranceMin: 48, reservePct: 0.3, onTaskMin: 5 },
  M4D: { id: 'M4D', label: 'Matrice 4D', cruiseKph: 54, enduranceMin: 49, reservePct: 0.3, onTaskMin: 5 },
  M350: { id: 'M350', label: 'Matrice 350 RTK', cruiseKph: 61, enduranceMin: 55, reservePct: 0.3, onTaskMin: 5 },
}

export const DOCK_MODELS: Record<DockModelId, DockSpec> = {
  DOCK3: { id: 'DOCK3', label: 'DJI Dock 3', drones: ['M4TD', 'M4D'] },
  DOCK2: { id: 'DOCK2', label: 'DJI Dock 2', drones: ['M350'] },
}

export interface RadiusBreakdown {
  radiusKm: number
  enduranceKm: number
  capKm: number
  bound: 'endurance' | 'cap' | 'override'
}

// Split out from effectiveRadius so the endurance-bound branch is reachable in
// a test: no catalogued airframe is currently endurance-bound, but the branch
// must be correct before real datasheet figures arrive.
export function radiusFromTerms(terms: {
  enduranceKm: number
  capKm: number
  override: number | undefined
}): RadiusBreakdown {
  const { enduranceKm, capKm, override } = terms
  if (override != null) return { radiusKm: override, enduranceKm, capKm, bound: 'override' }
  return enduranceKm <= capKm
    ? { radiusKm: enduranceKm, enduranceKm, capKm, bound: 'endurance' }
    : { radiusKm: capKm, enduranceKm, capKm, bound: 'cap' }
}

// The aircraft can usually fly much further than we plan for; BVLOS and
// airspace rules bind first. Reporting both terms lets the inspector show the
// headroom rather than an unexplained number.
export function effectiveRadius(dock: PlannedDock): RadiusBreakdown {
  const spec = DRONES[dock.droneModel]
  const usableMin = spec.enduranceMin * (1 - spec.reservePct)
  const outLegMin = (usableMin - spec.onTaskMin) / 2
  const enduranceKm = Math.max(0, (spec.cruiseKph / 60) * outLegMin)
  const capKm =
    dock.environment === 'urban' ? DOCK_RANGE.URBAN_RANGE_KM : DOCK_RANGE.RURAL_RANGE_KM
  return radiusFromTerms({ enduranceKm, capKm, override: dock.radiusKmOverride })
}
```

- [ ] **Step 4: Run the test**

```bash
cd app && npx vitest run src/modules/planner/domain/catalog.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add src/modules/planner/domain/
git commit -m "feat: dock/drone catalog with capped radius derivation"
```

---

### Task 6: The coverage engine

**Files:**
- Modify: `app/package.json`
- Create: `app/src/modules/planner/domain/coverage.ts`
- Test: `app/src/modules/planner/domain/coverage.test.ts`

**Interfaces:**
- Consumes: `effectiveRadius` (Task 5), `DeploymentPlan`, `CoverageResult` (Task 4).
- Produces: `computeCoverage(plan: DeploymentPlan): CoverageResult`, `BUFFER_STEPS = 64`.

- [ ] **Step 1: Install turf packages**

```bash
cd app && export npm_config_script_shell=bash && npm install @turf/buffer@7.3.5 @turf/union@7.3.5 @turf/intersect@7.3.5 @turf/difference@7.3.5 @turf/area@7.3.5 @turf/bbox@7.3.5 @turf/boolean-point-in-polygon@7.3.5 @turf/simplify@7.3.5 @turf/helpers@7.3.5
```

- [ ] **Step 2: Write the failing test**

Create `app/src/modules/planner/domain/coverage.test.ts`. The fixtures are hand-verifiable closed-form geometry:

```ts
import { describe, it, expect } from 'vitest'
import { computeCoverage } from './coverage'
import { createPlan, addAoi, addDock } from './plan'
import type { Aoi, PlannedDock } from './types'

// A ~20km x 20km box near Abu Dhabi. At 24.3 degrees latitude, 1 degree of
// latitude is ~111.2km and 1 degree of longitude is ~101.4km, so 0.18 lat by
// 0.197 lon is close enough to 20km x 20km for a +/-2% assertion.
const squareAoi = (): Aoi => ({
  id: 'a1',
  name: 'BOX',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5015, 24.21],
        [54.6985, 24.21],
        [54.6985, 24.39],
        [54.5015, 24.39],
        [54.5015, 24.21],
      ],
    ],
  },
})

const dockAt = (id: string, lon: number, lat: number): PlannedDock => ({
  id,
  name: id,
  position: [lon, lat],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural', // rural => 5km cap, so radius is exactly 5km
  source: 'manual',
})

describe('computeCoverage', () => {
  it('reports no-aoi before any AOI exists', () => {
    const r = computeCoverage(addDock(createPlan(), dockAt('d1', 54.6, 24.3)))
    expect(r).toEqual({ ok: false, reason: 'no-aoi' })
  })

  it('reports no-docks when an AOI exists but no docks do', () => {
    const r = computeCoverage(addAoi(createPlan(), squareAoi()))
    expect(r).toEqual({ ok: false, reason: 'no-docks' })
  })

  it('computes coverage for one centred 5km dock as pi*r^2 over the AOI', () => {
    // circle = pi * 5^2 = 78.54 km^2; AOI = 400 km^2 => 19.6%
    const plan = addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.aoiKm2).toBeCloseTo(400, -1) // within ~10 km^2
    expect(r.coveragePct).toBeGreaterThan(17.6)
    expect(r.coveragePct).toBeLessThan(21.6)
    expect(r.overlapPct).toBe(0)
    expect(r.gapCount).toBe(1)
  })

  it('computes overlap for two 5km docks 5km apart from the lens-area formula', () => {
    // Lens area for r=5, d=5:
    //   2r^2*acos(d/2r) - (d/2)*sqrt(4r^2 - d^2)
    // = 50*acos(0.5) - 2.5*sqrt(75) = 52.36 - 21.65 = 30.71 km^2
    // covered = 2*78.54 - 30.71 = 126.37 km^2
    // overlap = 30.71 / 126.37 = 24.3%
    const dLon = 5 / 101.4 // 5km east at this latitude
    const plan = addDock(
      addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6 - dLon / 2, 24.3)),
      dockAt('d2', 54.6 + dLon / 2, 24.3),
    )
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.overlapPct).toBeGreaterThan(22.3)
    expect(r.overlapPct).toBeLessThan(26.3)
  })

  it('excludes AOIs flagged invalid from the math', () => {
    const bad: Aoi = { ...squareAoi(), id: 'a2', valid: false }
    const plan = addAoi(addAoi(createPlan(), squareAoi()), bad)
    const withDock = addDock(plan, dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(withDock)
    if (!r.ok) throw new Error('expected ok')
    expect(r.aoiKm2).toBeCloseTo(400, -1) // not 800
  })

  it('attributes per-dock contribution area', () => {
    const plan = addDock(addAoi(createPlan(), squareAoi()), dockAt('d1', 54.6, 24.3))
    const r = computeCoverage(plan)
    if (!r.ok) throw new Error('expected ok')
    expect(r.perDock).toHaveLength(1)
    expect(r.perDock[0].dockId).toBe('d1')
    expect(r.perDock[0].grossContributionKm2).toBeCloseTo(78.5, 0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/domain/coverage.test.ts
```

Expected: FAIL — cannot resolve `./coverage`.

- [ ] **Step 4: Implement**

Create `app/src/modules/planner/domain/coverage.ts`:

```ts
import buffer from '@turf/buffer'
import union from '@turf/union'
import intersect from '@turf/intersect'
import difference from '@turf/difference'
import area from '@turf/area'
import { featureCollection, feature } from '@turf/helpers'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { effectiveRadius } from './catalog'
import type { CoverageResult, DeploymentPlan, PlannedDock } from './types'

// Circles at 8 steps (turf's default) are visibly octagonal at working zoom.
export const BUFFER_STEPS = 64

type Poly = Feature<Polygon | MultiPolygon>

// turf 7 takes a FeatureCollection, NOT two positional features. The v6
// two-argument signature is what most online examples still show.
function unionAll(polys: Poly[]): Poly | null {
  if (polys.length === 0) return null
  if (polys.length === 1) return polys[0]
  return union(featureCollection(polys))
}

function dockBuffer(dock: PlannedDock): Poly | null {
  const { radiusKm } = effectiveRadius(dock)
  if (radiusKm <= 0) return null
  const pt = feature({ type: 'Point', coordinates: dock.position } as const)
  return buffer(pt, radiusKm, { units: 'kilometers', steps: BUFFER_STEPS }) ?? null
}

const km2 = (f: Poly | null): number => (f ? area(f) / 1_000_000 : 0)

export function computeCoverage(plan: DeploymentPlan): CoverageResult {
  const valid = plan.aois.filter((a) => a.valid)
  if (valid.length === 0) return { ok: false, reason: 'no-aoi' }
  if (plan.docks.length === 0) return { ok: false, reason: 'no-docks' }

  const aoiGeom = unionAll(valid.map((a) => feature(a.geometry)))
  if (!aoiGeom) return { ok: false, reason: 'degenerate' }
  const aoiKm2 = km2(aoiGeom)
  if (aoiKm2 <= 0) return { ok: false, reason: 'degenerate' }

  const buffers = plan.docks
    .map((d) => ({ dock: d, geom: dockBuffer(d) }))
    .filter((b): b is { dock: PlannedDock; geom: Poly } => b.geom !== null)
  if (buffers.length === 0) return { ok: false, reason: 'degenerate' }

  const coverageGeom = unionAll(buffers.map((b) => b.geom))
  if (!coverageGeom) return { ok: false, reason: 'degenerate' }

  const covered = intersect(featureCollection([coverageGeom, aoiGeom]))
  const coveredKm2 = km2(covered)
  const coveragePct = (coveredKm2 / aoiKm2) * 100

  const uncoveredFeature = difference(featureCollection([aoiGeom, coverageGeom]))
  const uncovered: MultiPolygon = !uncoveredFeature
    ? { type: 'MultiPolygon', coordinates: [] }
    : uncoveredFeature.geometry.type === 'Polygon'
      ? { type: 'MultiPolygon', coordinates: [uncoveredFeature.geometry.coordinates] }
      : uncoveredFeature.geometry

  // Strict overlap: the union of all PAIRWISE buffer intersections, clipped to
  // the AOI. The cheap alternative (sum of dock areas minus the union) counts
  // triple-covered ground twice, which would overstate the number.
  const pairwise: Poly[] = []
  for (let i = 0; i < buffers.length; i += 1) {
    for (let j = i + 1; j < buffers.length; j += 1) {
      const lens = intersect(featureCollection([buffers[i].geom, buffers[j].geom]))
      if (lens) pairwise.push(lens)
    }
  }
  const multiCovered = unionAll(pairwise)
  const multiInAoi = multiCovered ? intersect(featureCollection([multiCovered, aoiGeom])) : null
  const overlapPct = coveredKm2 > 0 ? (km2(multiInAoi) / coveredKm2) * 100 : 0

  const perDock = buffers.map((b) => ({
    dockId: b.dock.id,
    grossContributionKm2: km2(intersect(featureCollection([b.geom, aoiGeom]))),
  }))

  return {
    ok: true,
    aoiKm2,
    coveragePct,
    overlapPct,
    uncovered,
    gapCount: uncovered.coordinates.length,
    perDock,
  }
}
```

- [ ] **Step 5: Run the test**

```bash
cd app && npx vitest run src/modules/planner/domain/coverage.test.ts
```

Expected: PASS, 7/7. If the closed-form assertions fail by more than the stated tolerance, the buffer units or steps are wrong; do **not** widen the tolerance to make it pass.

- [ ] **Step 6: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add package.json package-lock.json src/modules/planner/domain/
git commit -m "feat: coverage engine with strict pairwise overlap"
```

---

### Task 7: Deterministic auto-placement

**Files:**
- Create: `app/src/modules/planner/domain/autoPlace.ts`
- Test: `app/src/modules/planner/domain/autoPlace.test.ts`

**Interfaces:**
- Consumes: `computeCoverage` (Task 6), `effectiveRadius` (Task 5), `nextId`/`resetIdsForTest` (Task 4).
- Produces: `suggestLayout(plan: DeploymentPlan, opts?: { droneModel?: DroneModelId }): SuggestResult` where `SuggestResult = { docks: PlannedDock[]; achievedPct: number; stoppedBy: 'target' | 'cap' | 'gain' }`, plus exported constants `MAX_DOCKS`, `MIN_MARGINAL_GAIN_PCT`, `SAMPLE_SPACING_DIVISOR`, `MAX_SAMPLE_POINTS`.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/domain/autoPlace.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { suggestLayout, MAX_DOCKS, MIN_MARGINAL_GAIN_PCT } from './autoPlace'
import { createPlan, addAoi, resetIdsForTest } from './plan'
import type { Aoi } from './types'

const squareAoi = (): Aoi => ({
  id: 'a1',
  name: 'BOX',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5015, 24.21],
        [54.6985, 24.21],
        [54.6985, 24.39],
        [54.5015, 24.39],
        [54.5015, 24.21],
      ],
    ],
  },
})

describe('suggestLayout', () => {
  beforeEach(() => resetIdsForTest())

  it('exposes its tuning constants for tests to pin', () => {
    expect(MAX_DOCKS).toBe(40)
    expect(MIN_MARGINAL_GAIN_PCT).toBe(0.25)
  })

  it('returns no docks when there is no AOI', () => {
    const r = suggestLayout(createPlan())
    expect(r.docks).toEqual([])
    expect(r.achievedPct).toBe(0)
  })

  it('covers a 20km box to the required percentage', () => {
    const plan = addAoi(createPlan(), squareAoi())
    const r = suggestLayout(plan)
    expect(r.docks.length).toBeGreaterThan(0)
    expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
    expect(r.achievedPct).toBeGreaterThan(80)
  })

  it('marks every suggested dock with source auto', () => {
    const r = suggestLayout(addAoi(createPlan(), squareAoi()))
    expect(r.docks.every((d) => d.source === 'auto')).toBe(true)
  })

  it('is deterministic: identical input gives byte-identical output', () => {
    const plan = addAoi(createPlan(), squareAoi())
    resetIdsForTest()
    const a = suggestLayout(plan)
    resetIdsForTest()
    const b = suggestLayout(plan)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('respects the dock cap and reports why it stopped', () => {
    const plan = addAoi(createPlan(), squareAoi())
    const tight = { ...plan, params: { targetOverlapPct: 20, requiredCoveragePct: 100 } }
    const r = suggestLayout(tight)
    expect(['target', 'cap', 'gain']).toContain(r.stoppedBy)
    expect(r.docks.length).toBeLessThanOrEqual(MAX_DOCKS)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/domain/autoPlace.test.ts
```

Expected: FAIL — cannot resolve `./autoPlace`.

- [ ] **Step 3: Implement**

Create `app/src/modules/planner/domain/autoPlace.ts`:

```ts
import bbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { feature, featureCollection, point } from '@turf/helpers'
import union from '@turf/union'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { computeCoverage } from './coverage'
import { effectiveRadius } from './catalog'
import { nextId, setDocks } from './plan'
import type { DeploymentPlan, DroneModelId, PlannedDock } from './types'

export const MAX_DOCKS = 40
export const MIN_MARGINAL_GAIN_PCT = 0.25
export const SAMPLE_SPACING_DIVISOR = 4
export const MAX_SAMPLE_POINTS = 20000

export interface SuggestResult {
  docks: PlannedDock[]
  achievedPct: number
  stoppedBy: 'target' | 'cap' | 'gain'
}

const KM_PER_DEG_LAT = 111.2
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180)

function makeDock(lon: number, lat: number, droneModel: DroneModelId): PlannedDock {
  return {
    id: nextId('dock'),
    name: `PROPOSED ${lon.toFixed(3)} ${lat.toFixed(3)}`,
    position: [lon, lat],
    dockModel: droneModel === 'M350' ? 'DOCK2' : 'DOCK3',
    droneModel,
    environment: 'rural',
    source: 'auto',
  }
}

export function suggestLayout(
  plan: DeploymentPlan,
  opts?: { droneModel?: DroneModelId },
): SuggestResult {
  const droneModel = opts?.droneModel ?? 'M4TD'
  const valid = plan.aois.filter((a) => a.valid)
  if (valid.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const aoiGeom = valid
    .map((a) => feature(a.geometry) as Feature<Polygon | MultiPolygon>)
    .reduce<Feature<Polygon | MultiPolygon> | null>(
      (acc, f) => (acc ? union(featureCollection([acc, f])) : f),
      null,
    )
  if (!aoiGeom) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const radiusKm = effectiveRadius(makeDock(0, 0, droneModel)).radiusKm
  const [minLon, minLat, maxLon, maxLat] = bbox(aoiGeom)
  const midLat = (minLat + maxLat) / 2

  // Hex lattice anchored to the bbox MINIMUM corner. Never a centroid or a
  // random origin: the anchor is what makes the whole thing reproducible.
  const spacingKm = radiusKm * Math.sqrt(3) * (1 - plan.params.targetOverlapPct / 100)
  const dLat = spacingKm / KM_PER_DEG_LAT
  const dLon = spacingKm / kmPerDegLon(midLat)

  const candidates: [number, number][] = []
  let row = 0
  for (let lat = minLat; lat <= maxLat + dLat; lat += dLat, row += 1) {
    const offset = row % 2 === 0 ? 0 : dLon / 2 // hex stagger
    for (let lon = minLon + offset; lon <= maxLon + dLon; lon += dLon) {
      if (booleanPointInPolygon(point([lon, lat]), aoiGeom)) candidates.push([lon, lat])
    }
  }
  // Stable ordering: lat then lon ascending, so ties break identically.
  candidates.sort((a, b) => a[1] - b[1] || a[0] - b[0])

  // Rasterized sample grid for greedy scoring. Running an exact turf union per
  // candidate per iteration would be hundreds of polygon ops and would hang
  // the tab; one exact coverage computation runs at the end instead.
  let sampleSpacingKm = radiusKm / SAMPLE_SPACING_DIVISOR
  let samples: [number, number][] = []
  for (;;) {
    samples = []
    const sLat = sampleSpacingKm / KM_PER_DEG_LAT
    const sLon = sampleSpacingKm / kmPerDegLon(midLat)
    for (let lat = minLat; lat <= maxLat; lat += sLat) {
      for (let lon = minLon; lon <= maxLon; lon += sLon) {
        if (booleanPointInPolygon(point([lon, lat]), aoiGeom)) samples.push([lon, lat])
      }
    }
    if (samples.length <= MAX_SAMPLE_POINTS) break
    sampleSpacingKm *= 1.5 // widen deterministically, then re-sample
  }
  if (samples.length === 0) return { docks: [], achievedPct: 0, stoppedBy: 'gain' }

  const covered = new Array<boolean>(samples.length).fill(false)
  const withinRadius = (c: [number, number], s: [number, number]): boolean => {
    const dy = (s[1] - c[1]) * KM_PER_DEG_LAT
    const dx = (s[0] - c[0]) * kmPerDegLon(midLat)
    return dx * dx + dy * dy <= radiusKm * radiusKm
  }

  const chosen: [number, number][] = []
  let stoppedBy: SuggestResult['stoppedBy'] = 'gain'
  const total = samples.length

  for (;;) {
    if (chosen.length >= MAX_DOCKS) {
      stoppedBy = 'cap'
      break
    }
    const coveredCount = covered.filter(Boolean).length
    if ((coveredCount / total) * 100 >= plan.params.requiredCoveragePct) {
      stoppedBy = 'target'
      break
    }

    let bestIdx = -1
    let bestGain = 0
    for (let i = 0; i < candidates.length; i += 1) {
      let gain = 0
      for (let s = 0; s < samples.length; s += 1) {
        if (!covered[s] && withinRadius(candidates[i], samples[s])) gain += 1
      }
      if (gain > bestGain) {
        bestGain = gain
        bestIdx = i
      }
    }

    if (bestIdx < 0 || (bestGain / total) * 100 < MIN_MARGINAL_GAIN_PCT) {
      stoppedBy = 'gain'
      break
    }

    const pick = candidates[bestIdx]
    chosen.push(pick)
    candidates.splice(bestIdx, 1)
    for (let s = 0; s < samples.length; s += 1) {
      if (!covered[s] && withinRadius(pick, samples[s])) covered[s] = true
    }
  }

  const docks = chosen.map(([lon, lat]) => makeDock(lon, lat, droneModel))
  const exact = computeCoverage(setDocks(plan, docks))
  return { docks, achievedPct: exact.ok ? exact.coveragePct : 0, stoppedBy }
}
```

- [ ] **Step 4: Run the test**

```bash
cd app && npx vitest run src/modules/planner/domain/autoPlace.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add src/modules/planner/domain/
git commit -m "feat: deterministic hex-grid greedy auto-placement"
```

---

### Task 8: KML / KMZ import

**Files:**
- Modify: `app/package.json`
- Create: `app/src/modules/planner/io/kml.ts`
- Create: `app/src/modules/planner/io/fixtures/simple.kml`
- Test: `app/src/modules/planner/io/kml.test.ts`

**Interfaces:**
- Consumes: `Aoi` (Task 4), `nextId` (Task 4).
- Produces: `parseKmlText(xml: string): ImportResult`, `importAoiFile(file: File): Promise<ImportResult>`, `SIMPLIFY_VERTEX_THRESHOLD = 1500`, `SIMPLIFY_TOLERANCE = 0.0001`. `ImportResult = { ok: true; aois: Aoi[]; skipped: number } | { ok: false; code: 'UNREADABLE' | 'NO_KML' | 'BAD_XML' | 'NO_AREAS'; message: string }`.

- [ ] **Step 1: Install and create the fixture**

```bash
cd app && export npm_config_script_shell=bash && npm install @tmcw/togeojson@7.1.2 fflate@0.8.3
```

Create `app/src/modules/planner/io/fixtures/simple.kml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>AOI ONE</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>
        54.50,24.21 54.70,24.21 54.70,24.39 54.50,24.39 54.50,24.21
      </coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
    <Placemark>
      <name>A POINT</name>
      <Point><coordinates>54.6,24.3</coordinates></Point>
    </Placemark>
  </Document>
</kml>
```

- [ ] **Step 2: Write the failing test**

Create `app/src/modules/planner/io/kml.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { parseKmlText } from './kml'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/simple.kml', import.meta.url)), 'utf8')

describe('parseKmlText', () => {
  it('extracts polygon placemarks as AOIs and counts skipped features', () => {
    const r = parseKmlText(fixture)
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
    expect(r.aois).toHaveLength(1)
    expect(r.aois[0].name).toBe('AOI ONE')
    expect(r.aois[0].source).toBe('kml')
    expect(r.aois[0].valid).toBe(true)
    expect(r.skipped).toBe(1) // the Point placemark
  })

  it('reports BAD_XML on malformed input', () => {
    const r = parseKmlText('<kml><unclosed>')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('BAD_XML')
  })

  it('reports NO_AREAS when the file parses but holds no polygons', () => {
    const pointsOnly = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>P</name><Point><coordinates>54.6,24.3</coordinates></Point></Placemark>
      </Document></kml>`
    const r = parseKmlText(pointsOnly)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NO_AREAS')
    expect(r.message).toContain('1')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/io/kml.test.ts
```

Expected: FAIL — cannot resolve `./kml`.

- [ ] **Step 4: Implement**

Create `app/src/modules/planner/io/kml.ts`:

```ts
import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import { unzipSync, strFromU8 } from 'fflate'
import simplify from '@turf/simplify'
import { feature } from '@turf/helpers'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { nextId } from '../domain/plan'
import type { Aoi } from '../domain/types'

export const SIMPLIFY_VERTEX_THRESHOLD = 1500
export const SIMPLIFY_TOLERANCE = 0.0001

export type ImportResult =
  | { ok: true; aois: Aoi[]; skipped: number }
  | { ok: false; code: 'UNREADABLE' | 'NO_KML' | 'BAD_XML' | 'NO_AREAS'; message: string }

function countVertices(g: Polygon | MultiPolygon): number {
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  return rings.reduce((n, ring) => n + ring.length, 0)
}

// Simplification is applied to the STORED geometry, not just the drawn one,
// so the coverage number always describes the shape on screen.
function maybeSimplify(g: Polygon | MultiPolygon): { geometry: Polygon | MultiPolygon; from?: number } {
  const before = countVertices(g)
  if (before <= SIMPLIFY_VERTEX_THRESHOLD) return { geometry: g }
  const out = simplify(feature(g) as Feature<Polygon | MultiPolygon>, {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: false,
  })
  return { geometry: out.geometry, from: before }
}

export function parseKmlText(xml: string): ImportResult {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.querySelector('parsererror')) {
      return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT VALID XML' }
    }
  } catch {
    return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT VALID XML' }
  }

  let collection: ReturnType<typeof kmlToGeoJson>
  try {
    collection = kmlToGeoJson(doc)
  } catch {
    return { ok: false, code: 'BAD_XML', message: 'FILE IS NOT READABLE KML' }
  }

  const aois: Aoi[] = []
  let skipped = 0
  for (const f of collection.features) {
    const g = f.geometry
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const { geometry, from } = maybeSimplify(g)
      aois.push({
        id: nextId('aoi'),
        name: String(f.properties?.name ?? 'IMPORTED AREA').toUpperCase(),
        geometry,
        source: 'kml',
        valid: true,
        ...(from != null ? { simplifiedFrom: from } : {}),
      })
    } else {
      skipped += 1
    }
  }

  if (aois.length === 0) {
    return {
      ok: false,
      code: 'NO_AREAS',
      message: `${skipped} PLACEMARKS, 0 AREAS`,
    }
  }
  return { ok: true, aois, skipped }
}

export async function importAoiFile(file: File): Promise<ImportResult> {
  const isKmz = file.name.toLowerCase().endsWith('.kmz')
  if (!isKmz) return parseKmlText(await file.text())

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return { ok: false, code: 'UNREADABLE', message: 'KMZ IS NOT A READABLE ARCHIVE' }
  }
  const kmlName = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.kml'))
  if (!kmlName) return { ok: false, code: 'NO_KML', message: 'ARCHIVE CONTAINS NO KML' }
  const out = parseKmlText(strFromU8(entries[kmlName]))
  if (out.ok) return { ...out, aois: out.aois.map((a) => ({ ...a, source: 'kmz' as const })) }
  return out
}
```

- [ ] **Step 5: Run the test**

```bash
cd app && npx vitest run src/modules/planner/io/kml.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 6: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add package.json package-lock.json src/modules/planner/io/
git commit -m "feat: KML and KMZ AOI import with typed error results"
```

---

### Task 9: Planner map layers and imperative sync

**Files:**
- Create: `app/src/modules/planner/map/plannerStyle.ts`
- Create: `app/src/modules/planner/map/usePlannerLayers.ts`
- Test: `app/src/modules/planner/map/plannerStyle.test.ts`

**Interfaces:**
- Consumes: `buildBaseStyle` (Task 1), `isMapUsable`, `effectiveRadius` (Task 5), `DeploymentPlan`/`CoverageResult` (Task 4).
- Produces: `buildPlannerStyle(): StyleSpecification`, `PLANNER_SOURCES = { aoi, rings, docks, gaps }`, `aoiFeatures(plan)`, `dockFeatures(plan)`, `ringFeatures(plan)`, `usePlannerLayers(mapRef, ready, plan, coverage)`.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/map/plannerStyle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPlannerStyle, aoiFeatures, dockFeatures, PLANNER_SOURCES } from './plannerStyle'
import { createPlan, addAoi, addDock } from '../domain/plan'
import type { Aoi, PlannedDock } from '../domain/types'

const aoi: Aoi = {
  id: 'a1',
  name: 'BOX',
  source: 'drawn',
  valid: true,
  geometry: { type: 'Polygon', coordinates: [[[54.5, 24.2], [54.7, 24.2], [54.7, 24.4], [54.5, 24.2]]] },
}
const dock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
}

describe('buildPlannerStyle', () => {
  it('includes every planner source and no console sim sources', () => {
    const style = buildPlannerStyle()
    for (const id of Object.values(PLANNER_SOURCES)) {
      expect(style.sources[id]).toBeDefined()
    }
    // The planner has no simulation, so it must not inherit these.
    expect(style.sources['drones']).toBeUndefined()
    expect(style.sources['tracks']).toBeUndefined()
    expect(style.sources['wizard-preview']).toBeUndefined()
  })
})

describe('feature builders', () => {
  it('builds one polygon feature per valid AOI', () => {
    const fc = aoiFeatures(addAoi(createPlan(), aoi))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.id).toBe('a1')
  })

  it('builds one point feature per dock carrying its source for styling', () => {
    const fc = dockFeatures(addDock(createPlan(), dock))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.source).toBe('manual')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/map/plannerStyle.test.ts
```

Expected: FAIL — cannot resolve `./plannerStyle`.

- [ ] **Step 3: Implement `plannerStyle.ts`**

```ts
import type { StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson'
import buffer from '@turf/buffer'
import { feature, featureCollection } from '@turf/helpers'
import { buildBaseStyle } from '@/modules/console/map/style'
import { effectiveRadius } from '../domain/catalog'
import { BUFFER_STEPS } from '../domain/coverage'
import type { DeploymentPlan } from '../domain/types'

export const PLANNER_SOURCES = {
  aoi: 'planner-aoi',
  rings: 'planner-rings',
  docks: 'planner-docks',
  gaps: 'planner-gaps',
} as const

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

export function aoiFeatures(plan: DeploymentPlan): FeatureCollection {
  return featureCollection(
    plan.aois.map((a) =>
      feature(a.geometry, { id: a.id, name: a.name, valid: a.valid }),
    ) as Feature<Polygon | MultiPolygon>[],
  )
}

export function dockFeatures(plan: DeploymentPlan): FeatureCollection {
  return featureCollection(
    plan.docks.map((d) =>
      feature({ type: 'Point', coordinates: d.position }, {
        id: d.id,
        name: d.name,
        source: d.source,
      }),
    ) as Feature<Point>[],
  )
}

export function ringFeatures(plan: DeploymentPlan): FeatureCollection {
  const rings = plan.docks
    .map((d) => {
      const { radiusKm } = effectiveRadius(d)
      if (radiusKm <= 0) return null
      const b = buffer(feature({ type: 'Point', coordinates: d.position }), radiusKm, {
        units: 'kilometers',
        steps: BUFFER_STEPS,
      })
      if (!b) return null
      b.properties = { id: d.id }
      return b
    })
    .filter((f): f is Feature<Polygon | MultiPolygon> => f !== null)
  return featureCollection(rings)
}

// Base cartography plus four planner sources. Deliberately built from
// buildBaseStyle, not buildStyle, so no empty simulation layers come along.
export function buildPlannerStyle(): StyleSpecification {
  const base = buildBaseStyle()
  return {
    ...base,
    sources: {
      ...base.sources,
      [PLANNER_SOURCES.aoi]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.rings]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.docks]: { type: 'geojson', data: empty() },
      [PLANNER_SOURCES.gaps]: { type: 'geojson', data: empty() },
    },
    layers: [
      ...base.layers,
      {
        id: 'planner-rings-fill',
        type: 'fill',
        source: PLANNER_SOURCES.rings,
        paint: { 'fill-color': '#3ddc97', 'fill-opacity': 0.08 },
      },
      {
        id: 'planner-rings-line',
        type: 'line',
        source: PLANNER_SOURCES.rings,
        paint: { 'line-color': '#3ddc97', 'line-width': 1, 'line-opacity': 0.5 },
      },
      {
        id: 'planner-gaps-fill',
        type: 'fill',
        source: PLANNER_SOURCES.gaps,
        // Red is reserved for brand and alerts: an uncovered gap qualifies.
        paint: { 'fill-color': '#ff5a5a', 'fill-opacity': 0.18 },
      },
      {
        id: 'planner-aoi-line',
        type: 'line',
        source: PLANNER_SOURCES.aoi,
        paint: { 'line-color': '#e8ecf3', 'line-width': 1.5, 'line-dasharray': [2, 1] },
      },
      {
        id: 'planner-docks-circle',
        type: 'circle',
        source: PLANNER_SOURCES.docks,
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'source'], 'auto', '#7aa2f7', '#e8ecf3'],
          'circle-stroke-color': '#0a0b0e',
          'circle-stroke-width': 1.5,
        },
      },
    ],
  }
}
```

- [ ] **Step 4: Implement `usePlannerLayers.ts`**

```ts
import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { PLANNER_SOURCES, aoiFeatures, dockFeatures, ringFeatures } from './plannerStyle'
import type { CoverageResult, DeploymentPlan } from '../domain/types'

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(id) as GeoJSONSource | undefined
  if (src) src.setData(data)
}

// The plan -> map bridge. Panels re-render through React; the map is fed
// imperatively so a plan edit never rebuilds a MapLibre layer.
export function usePlannerLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  plan: DeploymentPlan,
  coverage: CoverageResult,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, PLANNER_SOURCES.aoi, aoiFeatures(plan))
    setData(map, PLANNER_SOURCES.docks, dockFeatures(plan))
    setData(map, PLANNER_SOURCES.rings, ringFeatures(plan))
    // `plan` alone is the correct dependency: every mutation returns a new
    // object, so plan.rev would be a redundant second key on the same change.
  }, [mapRef, ready, plan])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, PLANNER_SOURCES.gaps, {
      type: 'FeatureCollection',
      features: coverage.ok
        ? [{ type: 'Feature', geometry: coverage.uncovered, properties: {} }]
        : [],
    })
  }, [mapRef, ready, coverage])
}
```

- [ ] **Step 5: Run the test and switch `Planner.tsx` to the planner style**

```bash
cd app && npx vitest run src/modules/planner/map/plannerStyle.test.ts
```

Expected: PASS, 3/3. Then change `Planner.tsx` to pass `styleSpec={buildPlannerStyle()}`.

- [ ] **Step 6: Commit**

```bash
cd app && npm run typecheck && npm run lint && npx vitest run
git add src/modules/planner/
git commit -m "feat: planner map style, feature builders and imperative layer sync"
```

---

### Task 10: Coverage recompute driver with revision guard

**Files:**
- Create: `app/src/modules/planner/engine/useCoverageDriver.ts`
- Test: `app/src/modules/planner/engine/useCoverageDriver.test.ts`

**Interfaces:**
- Consumes: `computeCoverage` (Task 6), `usePlanStore` (Task 4).
- Produces: `useCoverageDriver()`, `COVERAGE_DEBOUNCE_MS = 150`, and the pure helper `shouldApply(resultRev: number, currentRev: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/engine/useCoverageDriver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldApply, COVERAGE_DEBOUNCE_MS } from './useCoverageDriver'

describe('shouldApply', () => {
  it('applies a result computed from the current revision', () => {
    expect(shouldApply(7, 7)).toBe(true)
  })

  it('discards a result whose plan revision is already stale', () => {
    // The plan changed while the computation was in flight. Writing this
    // result would show numbers for a plan that no longer exists.
    expect(shouldApply(6, 7)).toBe(false)
  })

  it('debounces at 150ms', () => {
    expect(COVERAGE_DEBOUNCE_MS).toBe(150)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/engine/useCoverageDriver.test.ts
```

Expected: FAIL — cannot resolve `./useCoverageDriver`.

- [ ] **Step 3: Implement**

```ts
import { useEffect, useRef } from 'react'
import { computeCoverage } from '../domain/coverage'
import { usePlanStore } from '../store/planStore'

export const COVERAGE_DEBOUNCE_MS = 150

// Extracted so the staleness rule is testable without timers or a store.
export function shouldApply(resultRev: number, currentRev: number): boolean {
  return resultRev === currentRev
}

export function useCoverageDriver(): void {
  const plan = usePlanStore((s) => s.plan)
  const setCoverage = usePlanStore((s) => s.setCoverage)
  const revRef = useRef(plan.rev)
  revRef.current = plan.rev

  useEffect(() => {
    const rev = plan.rev
    const t = setTimeout(() => {
      const result = computeCoverage(plan)
      if (shouldApply(rev, revRef.current)) setCoverage(result)
    }, COVERAGE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plan, setCoverage])
}
```

- [ ] **Step 4: Run the test**

```bash
cd app && npx vitest run src/modules/planner/engine/useCoverageDriver.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add src/modules/planner/engine/
git commit -m "feat: debounced coverage recompute with stale-revision guard"
```

---

### Task 11: Dock placement and dragging

**Files:**
- Create: `app/src/modules/planner/map/useDockPlacement.ts`
- Test: `app/src/modules/planner/map/useDockPlacement.test.ts`

**Interfaces:**
- Consumes: `PLANNER_SOURCES` (Task 9), `usePlanStore` (Task 4), `addDock`/`updateDock` (Task 4), `nextId` (Task 4), `isMapUsable`.
- Produces: `useDockPlacement(mapRef, ready)` returning `{ placing: boolean; startPlacing(): void; cancel(): void }`, and the pure helper `dockFromClick(lngLat, seqName): PlannedDock`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { dockFromClick } from './useDockPlacement'
import { resetIdsForTest } from '../domain/plan'

describe('dockFromClick', () => {
  beforeEach(() => resetIdsForTest())

  it('creates a manual dock at the clicked position', () => {
    const d = dockFromClick({ lng: 54.6, lat: 24.3 }, 1)
    expect(d.position).toEqual([54.6, 24.3])
    expect(d.source).toBe('manual')
    expect(d.name).toBe('DOCK 01')
  })

  it('auto-detects urban placement from the position', () => {
    // Abu Dhabi Corniche is inside an URBAN_CENTERS circle in the sim's
    // dock range model, so a dock dropped there defaults to urban (3km).
    const d = dockFromClick({ lng: 54.349, lat: 24.477 }, 1)
    expect(d.environment).toBe('urban')
  })

  it('defaults to rural in open desert', () => {
    const d = dockFromClick({ lng: 53.0, lat: 23.2 }, 1)
    expect(d.environment).toBe('rural')
  })

  it('zero-pads the sequence in the generated name', () => {
    expect(dockFromClick({ lng: 54.6, lat: 24.3 }, 12).name).toBe('DOCK 12')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && npx vitest run src/modules/planner/map/useDockPlacement.test.ts
```

Expected: FAIL — cannot resolve `./useDockPlacement`.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { DOCK_RANGE } from '@/modules/console/domain'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import type { GeoJSONSource } from 'maplibre-gl'
import { PLANNER_SOURCES, dockFeatures, ringFeatures } from './plannerStyle'
import { addDock, nextId, updateDock } from '../domain/plan'
import { usePlanStore } from '../store/planStore'
import type { PlannedDock } from '../domain/types'

export function dockFromClick(lngLat: { lng: number; lat: number }, seq: number): PlannedDock {
  const coords: [number, number] = [lngLat.lng, lngLat.lat]
  return {
    id: nextId('dock'),
    name: `DOCK ${String(seq).padStart(2, '0')}`,
    position: coords,
    dockModel: 'DOCK3',
    droneModel: 'M4TD',
    // Reuse the simulation's own urban-centre model so a planner ring matches
    // a console ring for the same location.
    environment: DOCK_RANGE.isUrbanDock({ coords }) ? 'urban' : 'rural',
    source: 'manual',
  }
}

export interface DockPlacement {
  placing: boolean
  startPlacing(): void
  cancel(): void
}

export function useDockPlacement(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
): DockPlacement {
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(placing)
  placingRef.current = placing

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!placingRef.current) return
      const { plan, setPlan } = usePlanStore.getState()
      setPlan(addDock(plan, dockFromClick(e.lngLat, plan.docks.length + 1)))
      setPlacing(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacing(false)
    }

    map.on('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Parent-first teardown: the map may already be removed here.
      if (isMapUsable(mapRef.current)) mapRef.current.off('click', onClick)
    }
  }, [mapRef, ready])

  // Drag. The store is NOT touched until mouseup: committing per mousemove
  // would re-render every panel and rebuild all N ring buffers on each frame,
  // which visibly stutters once a plan has tens of docks. During the drag the
  // dock and ring sources are fed directly instead, so the map still tracks
  // the cursor at full rate.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    let dragId: string | null = null

    const onDown = (e: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['planner-docks-circle'] })[0]
      if (!hit) return
      dragId = String(hit.properties?.id ?? '')
      map.dragPan.disable()
    }

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (!dragId) return
      // Imperative preview only: build the moved plan, push its geometry to
      // the map, and throw it away. Nothing enters React state.
      const preview = updateDock(usePlanStore.getState().plan, dragId, {
        position: [e.lngLat.lng, e.lngLat.lat],
      })
      const docksSrc = map.getSource(PLANNER_SOURCES.docks) as GeoJSONSource | undefined
      const ringsSrc = map.getSource(PLANNER_SOURCES.rings) as GeoJSONSource | undefined
      docksSrc?.setData(dockFeatures(preview))
      ringsSrc?.setData(ringFeatures(preview))
    }

    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!dragId) return
      const { plan, setPlan } = usePlanStore.getState()
      // The single commit for the whole gesture: one rev bump, one recompute.
      setPlan(updateDock(plan, dragId, { position: [e.lngLat.lng, e.lngLat.lat] }))
      dragId = null
      map.dragPan.enable()
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      if (!isMapUsable(mapRef.current)) return
      const m = mapRef.current
      m.off('mousedown', onDown)
      m.off('mousemove', onMove)
      m.off('mouseup', onUp)
    }
  }, [mapRef, ready])

  const startPlacing = useCallback(() => setPlacing(true), [])
  const cancel = useCallback(() => setPlacing(false), [])
  return { placing, startPlacing, cancel }
}
```

- [ ] **Step 4: Run the test**

```bash
cd app && npx vitest run src/modules/planner/map/useDockPlacement.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
cd app && npm run typecheck && npm run lint
git add src/modules/planner/map/
git commit -m "feat: dock placement and dragging on the console capture pattern"
```

---

### Task 12: Planner chrome, panels and plan persistence

**Files:**
- Create: `app/src/modules/planner/domain/planIo.ts`
- Create: `app/src/modules/planner/ui/planner.css`
- Create: `app/src/modules/planner/ui/PlannerTopbar.tsx`
- Create: `app/src/modules/planner/ui/PlanTree.tsx`
- Create: `app/src/modules/planner/ui/Inspector.tsx`
- Create: `app/src/modules/planner/ui/SummaryStrip.tsx`
- Modify: `app/src/modules/planner/ui/Planner.tsx`
- Test: `app/src/modules/planner/domain/planIo.test.ts`
- Test: `app/src/modules/planner/ui/SummaryStrip.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `serializePlan(plan): string`, `parsePlan(json: string): { ok: true; plan } | { ok: false; message }`, and the four components.

- [ ] **Step 1: Write the failing tests**

`planIo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serializePlan, parsePlan } from './planIo'
import { createPlan, addDock } from './plan'
import type { PlannedDock } from './types'

const dock: PlannedDock = {
  id: 'd1', name: 'D1', position: [54.6, 24.3], dockModel: 'DOCK3',
  droneModel: 'M4TD', environment: 'urban', source: 'manual',
}

describe('plan JSON round-trip', () => {
  it('survives serialize then parse unchanged', () => {
    const plan = addDock(createPlan({ name: 'ACME', customer: 'ACME CORP' }), dock)
    const out = parsePlan(serializePlan(plan))
    if (!out.ok) throw new Error(out.message)
    expect(out.plan).toEqual(plan)
  })

  it('rejects JSON that is not a plan', () => {
    const out = parsePlan('{"hello":true}')
    expect(out.ok).toBe(false)
  })

  it('rejects a future schema version', () => {
    const plan = { ...createPlan(), schemaVersion: 99 }
    const out = parsePlan(JSON.stringify(plan))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('99')
  })

  it('rejects malformed JSON without throwing', () => {
    expect(() => parsePlan('{not json')).not.toThrow()
    expect(parsePlan('{not json').ok).toBe(false)
  })
})
```

`SummaryStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SummaryStrip from './SummaryStrip'

describe('SummaryStrip', () => {
  it('renders a dash placeholder rather than NaN before an AOI exists', () => {
    render(<SummaryStrip coverage={{ ok: false, reason: 'no-aoi' }} dockCount={0} />)
    expect(screen.getByText(/NO AREA OF INTEREST/i)).toBeInTheDocument()
  })

  it('renders the headline numbers once coverage resolves', () => {
    render(
      <SummaryStrip
        coverage={{
          ok: true, aoiKm2: 412, coveragePct: 87.4, overlapPct: 23.1,
          uncovered: { type: 'MultiPolygon', coordinates: [] }, gapCount: 2, perDock: [],
        }}
        dockCount={6}
      />,
    )
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getByText('23%')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd app && npx vitest run src/modules/planner/domain/planIo.test.ts src/modules/planner/ui/SummaryStrip.test.tsx
```

Expected: FAIL — modules do not resolve.

- [ ] **Step 3: Implement `planIo.ts`**

```ts
import { PLAN_SCHEMA_VERSION } from './plan'
import type { DeploymentPlan } from './types'

export function serializePlan(plan: DeploymentPlan): string {
  return JSON.stringify(plan, null, 2)
}

export type ParseResult = { ok: true; plan: DeploymentPlan } | { ok: false; message: string }

export function parsePlan(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, message: 'FILE IS NOT VALID JSON' }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'FILE IS NOT A PLAN' }
  const p = raw as Partial<DeploymentPlan>
  if (!Array.isArray(p.aois) || !Array.isArray(p.docks) || typeof p.schemaVersion !== 'number') {
    return { ok: false, message: 'FILE IS NOT A PLAN' }
  }
  if (p.schemaVersion > PLAN_SCHEMA_VERSION) {
    return { ok: false, message: `PLAN SCHEMA ${p.schemaVersion} IS NEWER THAN THIS BUILD` }
  }
  return { ok: true, plan: p as DeploymentPlan }
}
```

- [ ] **Step 4: Implement `SummaryStrip.tsx`**

```tsx
import type { CoverageResult } from '../domain/types'

export interface SummaryStripProps {
  coverage: CoverageResult
  dockCount: number
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ps-stat">
      <span className="ps-val">{value}</span>
      <span className="lbl">{label}</span>
    </div>
  )
}

export default function SummaryStrip({ coverage, dockCount }: SummaryStripProps) {
  if (!coverage.ok) {
    const msg = coverage.reason === 'no-aoi' ? 'NO AREA OF INTEREST' : coverage.reason === 'no-docks' ? 'NO DOCKS PLACED' : 'GEOMETRY UNAVAILABLE'
    return (
      <div className="planner-summary">
        <span className="lbl">{msg}</span>
      </div>
    )
  }
  return (
    <div className="planner-summary">
      <Stat label="COVERAGE" value={`${Math.round(coverage.coveragePct)}%`} />
      <Stat label="OVERLAP" value={`${Math.round(coverage.overlapPct)}%`} />
      <Stat label="DOCKS" value={String(dockCount)} />
      <Stat label="GAPS" value={String(coverage.gapCount)} />
      <Stat label="AOI KM2" value={String(Math.round(coverage.aoiKm2))} />
    </div>
  )
}
```

- [ ] **Step 5: Implement the remaining chrome**

`PlannerTopbar.tsx` renders the e& logo, `DEPLOYMENT PLANNER`, and buttons `IMPORT AOI` (hidden `<input type="file" accept=".kml,.kmz">`), `DRAW ▾` (polygon / rectangle / circle), `+ DOCK`, `SUGGEST LAYOUT`, `EXPORT PLAN`, and a `← MODULES` link. `PlanTree.tsx` renders plan name/customer, the AOI list with per-shape km² and a `SIMPLIFIED` badge when `simplifiedFrom` is set, the dock list, and the two params sliders. `Inspector.tsx` renders the selected AOI or dock; for a dock it shows model, drone, environment and the radius with its `RadiusBreakdown`, including the headroom line when `bound === 'cap'`.

`planner.css` reuses the console's `--chrome` tokens and the 9.5px / .22em `.lbl` idiom. Import it from `Planner.tsx`.

`Planner.tsx` composes everything, calling `useCoverageDriver()`, `usePlannerLayers(...)`, `useAoiDraw(...)` and `useDockPlacement(...)` **inside** `<MapView>` so they mount only after `ready`.

- [ ] **Step 6: Run the tests**

```bash
cd app && npx vitest run src/modules/planner/
```

Expected: all planner tests pass.

- [ ] **Step 7: Commit**

```bash
cd app && npm run typecheck && npm run lint && npx vitest run
git add src/modules/planner/
git commit -m "feat: planner chrome, inspector, summary strip and plan JSON persistence"
```

---

### Task 13: Integration and browser verification

**Files:**
- Test: `app/src/modules/planner/planner.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPlan, addAoi, resetIdsForTest, setDocks } from './domain/plan'
import { suggestLayout } from './domain/autoPlace'
import { computeCoverage } from './domain/coverage'
import { parseKmlText } from './io/kml'
import { serializePlan, parsePlan } from './domain/planIo'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const fixture = readFileSync(
  fileURLToPath(new URL('./io/fixtures/simple.kml', import.meta.url)),
  'utf8',
)

describe('planner end to end (pure layers)', () => {
  beforeEach(() => resetIdsForTest())

  it('imports a KML, auto-places docks, reaches coverage and round-trips the plan', () => {
    const imported = parseKmlText(fixture)
    if (!imported.ok) throw new Error(imported.code)

    let plan = createPlan({ name: 'ACME', customer: 'ACME CORP' })
    for (const aoi of imported.aois) plan = addAoi(plan, aoi)

    const suggestion = suggestLayout(plan)
    expect(suggestion.docks.length).toBeGreaterThan(0)

    plan = setDocks(plan, suggestion.docks)
    const coverage = computeCoverage(plan)
    if (!coverage.ok) throw new Error('expected coverage')
    expect(coverage.coveragePct).toBeGreaterThan(80)

    const restored = parsePlan(serializePlan(plan))
    if (!restored.ok) throw new Error(restored.message)
    expect(restored.plan.docks).toHaveLength(suggestion.docks.length)
  })
})
```

- [ ] **Step 2: Run the full verification**

```bash
cd app && npm run typecheck && npm run lint && npm run format:check && npx vitest run && npm run build
cd .. && node --test tests/*.test.js
```

Expected: all app tests pass (233 console + the new planner tests), legacy 65/65, typecheck / lint / format / build clean.

- [ ] **Step 3: Verify in a real browser via Playwright MCP**

Run `npm run dev`, open `http://localhost:5173/planner`, and confirm each of:

1. Map renders, zero console errors.
2. `DRAW ▾ → POLYGON`, click 4 points, double-click. AOI outline appears; PlanTree lists it with a km² figure.
3. `+ DOCK`, click inside the AOI. A dock marker and its coverage ring appear; SummaryStrip shows a non-zero COVERAGE.
4. Drag the dock. The ring follows; coverage updates on release.
5. Select the dock. Inspector shows the radius with its derivation and the cap headroom.
6. `SUGGEST LAYOUT`. Multiple docks appear, COVERAGE rises above the target, GAPS drops.
7. Import the KMZ/KML fixture. AOI appears; a file with no polygons shows `n PLACEMARKS, 0 AREAS`.
8. Navigate to `/`, then back to `/planner`, twice. Zero console errors both times.
9. `EXPORT PLAN`, then re-import the downloaded file. Plan is restored.

- [ ] **Step 4: Screenshot and commit**

```bash
git add src/modules/planner/
git commit -m "test: planner end-to-end integration across import, placement and coverage"
```

---

## Self-Review

**Spec coverage.** §1 scope → Tasks 3, 8 (AOI), 11 (placement), 5 (catalog), 6 (coverage), 7 (auto-placement), 12 (persistence). §4 architecture → Tasks 1, 2, 4. §5 domain model → Task 4. §6 radius → Task 5. §7 coverage → Task 6. §8 auto-placement → Task 7. §9 data flow → Tasks 9, 10. §10 layout → Task 12. §11 error handling → Tasks 3 (teardown), 8 (import codes, simplification), 6 (`ok:false` branches), 7 (dock cap). §12 testing → every task, plus Task 13. §13 risks → Task 3 is the terra-draw spike, run first as required.

**Gap found and closed:** the spec's §11 rule that an invalid AOI is excluded from the math had no test; `coverage.test.ts` now asserts it directly. The spec's localStorage autosave is folded into Task 12 rather than given its own task, since it is three lines around `serializePlan`.

**Known deviation:** `catalog.test.ts`'s fifth case cannot force an endurance-bound dock with the seeded figures, because every seeded airframe exceeds both caps. It asserts the cap branch explicitly instead and documents why. If real datasheet figures land lower, add a genuine endurance-bound case then.

**Type consistency check.** `effectiveRadius` returns `RadiusBreakdown` and is called that way in Tasks 6, 9, 12. `computeCoverage(plan)` takes a whole plan in Tasks 7, 10, 13. `PLANNER_SOURCES` keys match between `plannerStyle.ts` and `usePlannerLayers.ts`. `nextId`/`resetIdsForTest` are defined in Task 4 and used in Tasks 7, 8, 11, 13. `setDocks` is defined in Task 4 and used in Tasks 7 and 13.
