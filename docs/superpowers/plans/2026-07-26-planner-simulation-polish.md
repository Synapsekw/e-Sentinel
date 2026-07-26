# Planner + Simulation Polish and Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/planner` read as the same product as `/console` — fixing the basemap-hook collision that strips the planner's cartography, adding an AOI fill and a km radius slider, porting map-click selection, and unifying naming, labels, layout and legibility.

**Architecture:** Ten changes across four layers. The domain (`planner/domain/plan.ts`, `autoPlace.ts`) gains pure naming helpers. The map layer gains one style layer, one selection hook, and a selection-filter effect, all following the existing imperative "plan → map" convention where panels re-render through React but the map is fed directly. The UI layer restyles one control and regroups the topbar. Three facts currently duplicated between console and planner are extracted to the module the codebase already designates for shared basemap facts.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + React Testing Library (jsdom), Zustand, MapLibre GL, terra-draw, Turf.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-planner-simulation-polish-design.md`. Base: `master` @ `6ea64ec`.
- All commands run from `app/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Red is reserved for brand and alerts only (`PRODUCT.md`). Green means coverage in the planner. Armed tool states are amber (`var(--amber)`).
- Planner CSS uses `pl-*` class names and must not import `console/chrome/chrome.css` (see `planner.css`'s header comment).
- `PLAN_SCHEMA_VERSION` stays `1`. No change to the plan schema, so existing exports and autosaves must load unchanged.
- Domain code must stay reproducible: no `Math.random()`, no bare `Date.now()`/`new Date()` — ids come from `nextId`, timestamps from the injectable `now()` in `plan.ts`.
- Every map hook removes every listener it registers on cleanup, and probes `isMapUsable(map)` before touching a map that may already be torn down.
- Test files that use `toBeInTheDocument` must import `'@testing-library/jest-dom/vitest'` — this repo sets no `test.setupFiles`.
- jsdom-dependent test files start with the `// @vitest-environment jsdom` pragma.
- Commit after each task. Do not use `--no-verify`.

## File Structure

**Created:**
- `app/src/modules/console/map/useBasemap.test.ts` — unit tests for the new `enabled` gate.
- `app/src/modules/planner/map/usePlannerSelection.ts` — map-click selection for the planner.
- `app/src/modules/planner/map/usePlannerSelection.test.ts` — its tests.

**Modified:**
- `app/src/modules/console/map/useBasemap.ts` — `enabled` parameter.
- `app/src/modules/console/map/MapView.tsx` — `manageBasemap` prop.
- `app/src/modules/console/map/basemap.ts` — home for shared `LAYER_LABELS`/`LAYER_ORDER`.
- `app/src/modules/console/chrome/LayersMenu.tsx`, `chrome/Topbar.tsx` — import the shared constants instead of their own copies.
- `app/src/modules/console/OfflineChip.tsx` — optional `className` prop.
- `app/src/modules/planner/domain/plan.ts` — `nextDockName`, `nextAoiName`, `uniqueName`.
- `app/src/modules/planner/domain/autoPlace.ts` — `makeDock` naming.
- `app/src/modules/planner/map/plannerStyle.ts` — `planner-aoi-fill`, `planner-rings-line-hi`.
- `app/src/modules/planner/map/useDockPlacement.ts` — `dockFromClick` takes a name.
- `app/src/modules/planner/map/usePlannerLayers.ts` — selection-filter effect.
- `app/src/modules/planner/ui/Planner.tsx` — `manageBasemap={false}`, naming call sites, selection hook wiring.
- `app/src/modules/planner/ui/PlannerLayersMenu.tsx` — active-layer label, shared constants.
- `app/src/modules/planner/ui/PlannerTopbar.tsx` — regrouped order, offline chip.
- `app/src/modules/planner/ui/Inspector.tsx` — radius slider.
- `app/src/modules/planner/ui/planner.css` — chip styles, legibility, responsive drop-out.
- Test files alongside each of the above.

**Task order rationale:** Task 1 is the standalone bug. Task 4 (AOI fill) precedes Tasks 7–8, which need a fill layer to click on and to highlight. Task 5 (naming) is independent domain work. CSS-only tasks (9, 10) come late so they style final markup.

---

### Task 1: Stop the console basemap hook managing the planner's map

**Files:**
- Modify: `app/src/modules/console/map/useBasemap.ts:63-89`
- Modify: `app/src/modules/console/map/MapView.tsx:36-44` (props), `:107` (hook call)
- Modify: `app/src/modules/planner/ui/Planner.tsx:373-382`
- Test: `app/src/modules/console/map/useBasemap.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useBasemap(mapRef: MutableRefObject<maplibregl.Map | null>, ready: boolean, enabled?: boolean): void` — `enabled` defaults to `true`. `MapViewProps` gains `manageBasemap?: boolean`, default `true`.

**Background for the implementer:** `MapView` is shared by `/console` and `/planner`. It calls the console's `useBasemap`, whose apply step runs `setOperationalLayersVisible(map, scene === 'console')`. `OPERATIONAL_LAYER_IDS` includes `uae-places` and `uae-roads` — the UAE city labels and road network. The store's default `scene` is `'globe'`, so a cold-loaded `/planner` has those layers set to `visibility: 'none'` and shows no city names at all. Visiting `/console` and entering the theater first flips `scene` to `'console'` and the planner then *does* show them. Measured: 0 labels rendered cold, 9 rendered via the console. The planner has its own `usePlannerBasemap` and needs no help from this hook.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/console/map/useBasemap.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useBasemap } from './useBasemap'
import { useAppStore } from '@/shared/store'

// Fake map implementing only the slice useBasemap touches: setLayoutProperty,
// setPaintProperty, getLayer, plus `style` for isMapUsable-style probes.
// Same approach as planner/map/useDockPlacement.test.ts's makeFakeMap.
function makeFakeMap() {
  const setLayoutProperty = vi.fn()
  const setPaintProperty = vi.fn()
  const mapLike = {
    style: {},
    setLayoutProperty,
    setPaintProperty,
    getLayer: vi.fn((id: string) => ({ id })),
  }
  return {
    map: mapLike as unknown as maplibregl.Map,
    setLayoutProperty,
    setPaintProperty,
  }
}

const pristine = useAppStore.getState()

describe('useBasemap enabled gate', () => {
  let fake: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    fake = makeFakeMap()
    mapRef = { current: fake.map }
    useAppStore.setState({ ...pristine, scene: 'globe', layer: 'dark', offline: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStore.setState(pristine)
  })

  it('touches no layer at all when disabled', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    expect(fake.setLayoutProperty).not.toHaveBeenCalled()
    expect(fake.setPaintProperty).not.toHaveBeenCalled()
  })

  it('applies the basemap when the parameter is omitted, so the console is unchanged', () => {
    renderHook(() => useBasemap(mapRef, true))
    // raster-dark/light/sat/terrain visibility is set on every apply.
    const ids = fake.setLayoutProperty.mock.calls.map((c) => c[0] as string)
    expect(ids).toContain('raster-dark')
    expect(ids).toContain('raster-sat')
  })

  it('hides the UAE cartography layers in the globe scene when enabled', () => {
    // This is the behaviour the planner must NOT inherit: uae-places driven to
    // 'none' because the store's default scene is 'globe'.
    renderHook(() => useBasemap(mapRef, true))
    const places = fake.setLayoutProperty.mock.calls.find(
      (c) => c[0] === 'uae-places' && c[1] === 'visibility',
    )
    expect(places?.[2]).toBe('none')
  })

  it('does not hide the UAE cartography layers when disabled', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    const places = fake.setLayoutProperty.mock.calls.find((c) => c[0] === 'uae-places')
    expect(places).toBeUndefined()
  })

  it('stays inert when disabled even if the store changes afterwards', () => {
    renderHook(() => useBasemap(mapRef, true, false))
    useAppStore.setState({ layer: 'sat' })
    expect(fake.setLayoutProperty).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/modules/console/map/useBasemap.test.ts`

Expected: FAIL. `useBasemap` takes two parameters, so the third argument is ignored and the "touches no layer at all when disabled" test fails with `setLayoutProperty` having been called.

- [ ] **Step 3: Add the `enabled` parameter**

In `app/src/modules/console/map/useBasemap.ts`, replace the `useBasemap` signature and the effect's guard:

```ts
// `enabled` exists for ONE caller: the planner. MapView is shared by /console
// and /planner, and this hook is the console's -- its apply step drives
// OPERATIONAL_LAYER_IDS off the store's `scene`, and `uae-places`/`uae-roads`
// are in that list. The planner has no scene of its own (the store default is
// 'globe'), so left enabled this hook hides the planner's city labels and road
// network on a cold load, and leaves them visible only if the user happened to
// enter the console theater first -- cartography that depended on navigation
// history. The planner owns its basemap through usePlannerBasemap; this hook
// must not also write those layers. A parameter, not a condition around the
// call site: React forbids conditional hook calls.
export function useBasemap(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !ready) return
    const map = mapRef.current
    if (!map) return
```

and add `enabled` to the effect's dependency array:

```ts
  }, [mapRef, ready, enabled])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/modules/console/map/useBasemap.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the `manageBasemap` prop to MapView**

In `app/src/modules/console/map/MapView.tsx`, add to `MapViewProps`:

```ts
export interface MapViewProps {
  children?: ReactNode
  initialCenter?: [number, number]
  initialZoom?: number
  styleSpec?: StyleSpecification
  // False for consumers that manage their own basemap. The planner does
  // (usePlannerBasemap), and must: useBasemap drives operational-layer
  // visibility off the console's `scene`, which would strip the planner's
  // uae-places/uae-roads cartography. See useBasemap's `enabled` comment.
  manageBasemap?: boolean
}
```

destructure it with a default:

```ts
export default function MapView({
  children,
  initialCenter = MAP_VIEW_DEFAULTS.center,
  initialZoom = MAP_VIEW_DEFAULTS.zoom,
  styleSpec,
  manageBasemap = true,
}: MapViewProps) {
```

and forward it at the hook call (currently `useBasemap(mapRef, ready)`):

```ts
  useBasemap(mapRef, ready, manageBasemap)
  useOffline(mapRef)
```

Leave `useOffline` unconditional — offline fallback is map-lifecycle behaviour both routes want.

- [ ] **Step 6: Opt the planner out**

In `app/src/modules/planner/ui/Planner.tsx`, in the `Planner` component's `<MapView>`:

```tsx
      <MapView
        initialCenter={PLANNER_CENTER}
        initialZoom={PLANNER_ZOOM}
        styleSpec={buildPlannerStyle()}
        manageBasemap={false}
      >
        <PlannerShell />
      </MapView>
```

- [ ] **Step 7: Run the full suite**

Run: `cd app && npm run test && npm run typecheck && npm run lint`

Expected: all pass. No existing test should change behaviour — `manageBasemap` and `enabled` both default to the current behaviour.

- [ ] **Step 8: Commit**

```bash
git add app/src/modules/console/map/useBasemap.ts app/src/modules/console/map/useBasemap.test.ts app/src/modules/console/map/MapView.tsx app/src/modules/planner/ui/Planner.tsx
git commit -m "fix(planner): stop the console basemap hook stripping planner cartography"
```

---

### Task 2: One source for the basemap layer labels

**Files:**
- Modify: `app/src/modules/console/map/basemap.ts` (append constants)
- Modify: `app/src/modules/console/chrome/LayersMenu.tsx:13-20`
- Modify: `app/src/modules/console/chrome/Topbar.tsx:50-55`, `:88`
- Modify: `app/src/modules/planner/ui/PlannerLayersMenu.tsx:16-23`, `:44`
- Test: `app/src/modules/console/map/basemap.test.ts` (extend), `app/src/modules/planner/ui/PlannerLayersMenu.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LAYER_LABELS: Record<MapLayer, string>` and `LAYER_ORDER: MapLayer[]`, both exported from `@/modules/console/map/basemap`. Also `layerButtonLabel(layer: MapLayer): string` returning e.g. `'LAYERS · DARK'`.

**Background:** `LAYER_LABELS` is currently written out three times (`LayersMenu.tsx`, `Topbar.tsx`, `PlannerLayersMenu.tsx`) and `LAYER_ORDER` twice. `basemap.ts`'s own header states these basemap facts are deliberately not duplicated per module, because this project's two worst shipped bugs were both duplicated facts drifting apart. The console's trigger reads `LAYERS · DARK`; the planner's reads only `LAYERS`, so a planner user cannot see which basemap is active without opening the menu. That was the user's reported "cannot select the different layers" symptom — a discoverability failure, not a broken control.

- [ ] **Step 1: Write the failing test**

Append to `app/src/modules/console/map/basemap.test.ts`:

```ts
import { LAYER_LABELS, LAYER_ORDER, layerButtonLabel } from './basemap'

describe('basemap layer labels', () => {
  it('labels every basemap the store can hold', () => {
    expect(LAYER_LABELS).toEqual({
      dark: 'DARK',
      light: 'LIGHT',
      sat: 'SATELLITE',
      terrain: 'TERRAIN',
    })
  })

  it('orders the picker rows dark, light, satellite, terrain', () => {
    expect(LAYER_ORDER).toEqual(['dark', 'light', 'sat', 'terrain'])
  })

  it('every ordered layer has a label', () => {
    for (const l of LAYER_ORDER) expect(LAYER_LABELS[l]).toBeTruthy()
  })

  it('builds the trigger label both topbars show', () => {
    expect(layerButtonLabel('dark')).toBe('LAYERS · DARK')
    expect(layerButtonLabel('sat')).toBe('LAYERS · SATELLITE')
  })
})
```

Create `app/src/modules/planner/ui/PlannerLayersMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PlannerLayersMenu from './PlannerLayersMenu'
import { useAppStore } from '@/shared/store'

const pristine = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(pristine)
})

describe('PlannerLayersMenu trigger label', () => {
  it('names the active basemap, matching the console topbar', () => {
    useAppStore.setState({ layer: 'dark' })
    render(<PlannerLayersMenu open={false} onToggle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('LAYERS · DARK')
  })

  it('tracks a change of basemap', () => {
    useAppStore.setState({ layer: 'terrain' })
    render(<PlannerLayersMenu open={false} onToggle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('LAYERS · TERRAIN')
  })

  it('check-marks the active row when open', () => {
    useAppStore.setState({ layer: 'sat' })
    render(<PlannerLayersMenu open onToggle={vi.fn()} onClose={vi.fn()} />)
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows).toHaveLength(4)
    const active = rows.find((r) => r.getAttribute('aria-checked') === 'true')
    expect(active).toHaveTextContent('SATELLITE')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/modules/console/map/basemap.test.ts src/modules/planner/ui/PlannerLayersMenu.test.tsx`

Expected: FAIL — `LAYER_LABELS`, `LAYER_ORDER` and `layerButtonLabel` are not exported from `basemap.ts`, and the planner trigger renders `LAYERS ▾` not `LAYERS · DARK`.

- [ ] **Step 3: Add the shared constants**

Append to `app/src/modules/console/map/basemap.ts`:

```ts
// ---------------------------------------------------------------------------
// Basemap naming, shared by the console topbar/LayersMenu and the planner's
// PlannerLayersMenu. Previously written out three times; this module's header
// already records why basemap facts live in exactly one place.
// ---------------------------------------------------------------------------

export const LAYER_LABELS: Record<MapLayer, string> = {
  dark: 'DARK',
  light: 'LIGHT',
  sat: 'SATELLITE',
  terrain: 'TERRAIN',
}

// Row order in every basemap picker. Darkest to lightest, imagery last.
export const LAYER_ORDER: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

// The dropdown trigger's text. Both modules name the ACTIVE basemap in the
// button so it is readable without opening the menu.
export function layerButtonLabel(layer: MapLayer): string {
  return `LAYERS · ${LAYER_LABELS[layer] ?? String(layer).toUpperCase()}`
}
```

- [ ] **Step 4: Point all three consumers at it**

In `app/src/modules/console/chrome/LayersMenu.tsx`, delete the local `LAYER_LABELS` and `LAYER_ORDER` consts and the now-unused `MapLayer` type import, and import instead:

```ts
import { LAYER_LABELS, LAYER_ORDER } from '@/modules/console/map/basemap'
```

In `app/src/modules/console/chrome/Topbar.tsx`, delete the local `LAYER_LABELS` const (lines 46-55, including its comment) and replace line 88:

```ts
  const layerLabel = layerButtonLabel(layer)
```

adding to the imports:

```ts
import { layerButtonLabel } from '@/modules/console/map/basemap'
```

In `app/src/modules/planner/ui/PlannerLayersMenu.tsx`, delete the local `LAYER_LABELS`/`LAYER_ORDER` consts and the `MapLayer` type import, import the shared trio, and change the trigger's text from `LAYERS ▾` to:

```tsx
        {layerButtonLabel(layer)} ▾
```

Import line:

```ts
import { LAYER_LABELS, LAYER_ORDER, layerButtonLabel } from '@/modules/console/map/basemap'
```

Update the file's header comment: the note that labels are "verbatim from the console's chrome/LayersMenu.tsx" is now stale — they are imported from the shared module, not copied.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/modules/console/map/basemap.test.ts src/modules/planner/ui/PlannerLayersMenu.test.tsx src/modules/console/chrome/Topbar.test.tsx`

Expected: PASS. `Topbar.test.tsx` must still pass unchanged — the console's label format is unchanged, it just comes from elsewhere now.

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/console/map/basemap.ts app/src/modules/console/map/basemap.test.ts app/src/modules/console/chrome/LayersMenu.tsx app/src/modules/console/chrome/Topbar.tsx app/src/modules/planner/ui/PlannerLayersMenu.tsx app/src/modules/planner/ui/PlannerLayersMenu.test.tsx
git commit -m "refactor(map): one source for basemap labels; planner names its active layer"
```

---

### Task 3: Regroup the planner topbar and add the offline chip

**Files:**
- Modify: `app/src/modules/console/OfflineChip.tsx`
- Modify: `app/src/modules/planner/ui/PlannerTopbar.tsx:96-207`
- Modify: `app/src/modules/planner/ui/planner.css` (add `.pl-chip`)
- Test: `app/src/modules/planner/ui/PlannerTopbar.test.tsx` (create)

**Interfaces:**
- Consumes: `layerButtonLabel` from Task 2 (already wired into `PlannerLayersMenu`).
- Produces: `OfflineChipProps { className?: string }`, default `'chip warn'`. `PlannerTopbar`'s existing prop interface is unchanged.

**Background:** In the console, `LAYERS` is the first button after the `.sp` spacer. In the planner it is 7th, after `IMPORT PLAN` — the user reported never finding it. Regrouping puts it in the same place in both modules. The console also shows an offline chip; the planner does not, even though offline mode makes `usePlannerBasemap` pass `eff = null` and hide every raster. `OfflineChip` hardcodes `className="chip warn"` from `chrome.css`, which the planner does not import, so it needs an optional class override.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/ui/PlannerTopbar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import PlannerTopbar from './PlannerTopbar'
import { useAppStore } from '@/shared/store'

const pristine = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(pristine)
})

function renderTopbar() {
  return render(
    <MemoryRouter>
      <PlannerTopbar
        drawMode="idle"
        onSetDrawMode={vi.fn()}
        onCancelDraw={vi.fn()}
        placingDock={false}
        onToggleDockPlacement={vi.fn()}
        onImportAoiFile={vi.fn()}
        onImportPlanFile={vi.fn()}
        onExportPlan={vi.fn()}
        onSuggestLayout={vi.fn()}
        suggestBusy={false}
      />
    </MemoryRouter>,
  )
}

describe('PlannerTopbar grouping', () => {
  it('leads the action row with LAYERS, as the console topbar does', () => {
    useAppStore.setState({ layer: 'dark' })
    renderTopbar()
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t.length > 0)
    expect(labels[0]).toContain('LAYERS · DARK')
  })

  it('keeps every tool control reachable', () => {
    renderTopbar()
    for (const label of [
      'LAYERS · DARK',
      'DRAW',
      '+ DOCK',
      'SUGGEST LAYOUT',
      'IMPORT AOI',
      'IMPORT PLAN',
      'EXPORT PLAN',
    ]) {
      expect(
        screen.getAllByRole('button').some((b) => b.textContent?.includes(label)),
      ).toBe(true)
    }
    expect(screen.getByRole('link', { name: /MODULES/ })).toBeInTheDocument()
  })
})

describe('PlannerTopbar offline chip', () => {
  it('is hidden while online', () => {
    useAppStore.setState({ offline: false })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).not.toBeVisible()
  })

  it('shows when the map has fallen back to the offline vector map', () => {
    useAppStore.setState({ offline: true })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).toBeVisible()
  })

  it('wears the planner chip class, not the console chrome.css one', () => {
    useAppStore.setState({ offline: true })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).toHaveClass('pl-chip')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/modules/planner/ui/PlannerTopbar.test.tsx`

Expected: FAIL — no offline chip is rendered, and `LAYERS` is not first.

- [ ] **Step 3: Give OfflineChip an optional className**

Replace the component in `app/src/modules/console/OfflineChip.tsx`:

```tsx
export interface OfflineChipProps {
  // The planner does not import chrome.css (see planner.css's header), so it
  // supplies its own pl-* classes. Default reproduces the console's markup
  // exactly, so every existing call site is unaffected.
  className?: string
}

export default function OfflineChip({ className = 'chip warn' }: OfflineChipProps = {}) {
  const offline = useAppStore((s) => s.offline)

  return (
    <div className={className} id="offline-chip" hidden={!offline}>
      OFFLINE MODE · VECTOR MAP
    </div>
  )
}
```

- [ ] **Step 4: Add the planner chip style**

In `app/src/modules/planner/ui/planner.css`, after the `.pl-btn-ghost` rule, add:

```css
/* Offline indicator, the planner's counterpart to chrome.css's .chip.warn.
   Amber, not red: offline is a degraded state, not an alert, and red stays
   reserved for brand + alerts. Toggled via the `hidden` attribute rather than
   unmounting, matching OfflineChip's existing behaviour. */
.pl-chip {
  flex: none;
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 6px 10px;
  border-radius: 99px;
  border: 1px solid var(--line);
  color: var(--dim);
  white-space: nowrap;
}
.pl-chip-warn {
  color: var(--amber);
  border-color: color-mix(in srgb, var(--amber) 45%, transparent);
}
.pl-chip[hidden] {
  display: none;
}
```

- [ ] **Step 5: Regroup the topbar**

In `app/src/modules/planner/ui/PlannerTopbar.tsx`, add the import:

```ts
import OfflineChip from '@/modules/console/OfflineChip'
```

Then restructure the returned `<header>` so the children are, in order: `.pl-brand`, `<OfflineChip className="pl-chip pl-chip-warn" />`, `.pl-spacer`, the `LAYERS` dropdown, the `DRAW` dropdown, `+ DOCK`, `SUGGEST LAYOUT`, `IMPORT AOI` (with its hidden input), `IMPORT PLAN` (with its hidden input), `EXPORT PLAN`, then the `← MODULES` link.

Move the existing JSX blocks; do not rewrite their contents. The two `<input type="file">` elements must stay adjacent to the buttons that trigger them so the refs keep working. Update the file's header comment, which currently describes the old order ("then the tool row (import AOI / draw / dock placement / suggest layout / plan export-import / basemap LAYERS)"), to:

```
// Topbar chrome: e& brand and the offline chip, then a spacer, then the action
// row led by basemap LAYERS -- the same position the console's #btn-layers
// occupies after its own `.sp` spacer, so the control is in one place in the
// user's memory across both modules. Then the map tools (draw, dock placement,
// suggest layout) and the plan I/O controls.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/modules/planner/ui/PlannerTopbar.test.tsx src/modules/planner/ui/Planner.test.tsx src/modules/console/chrome/Topbar.test.tsx`

Expected: PASS. If `Planner.test.tsx` asserts topbar button order it will need updating; if it only asserts presence, it passes unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/console/OfflineChip.tsx app/src/modules/planner/ui/PlannerTopbar.tsx app/src/modules/planner/ui/PlannerTopbar.test.tsx app/src/modules/planner/ui/planner.css
git commit -m "feat(planner): lead the action row with LAYERS and surface offline state"
```

---

### Task 4: Fill the AOI polygon

**Files:**
- Modify: `app/src/modules/planner/map/plannerStyle.ts:77-128`
- Test: `app/src/modules/planner/map/plannerStyle.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: layer id `'planner-aoi-fill'` on source `PLANNER_SOURCES.aoi`, positioned first in the planner layer block. Tasks 7 and 8 both reference this id.

**Background:** `buildPlannerStyle` declares `planner-aoi-line` and no fill, so a committed polygon is a dashed outline over bare map — the user's "that polygon is transparent until you add the first dock". Once docks exist, the green coverage rings fill the interior and it *looks* filled. The fill must sit below `planner-rings-fill` so coverage green and gap red still read on top. `aoiFeatures` already emits a `valid` property, so no source change is needed; an invalid ring (excluded from coverage entirely by `computeCoverage`) takes the alert tint so its exclusion is visible on the map, not just as a panel badge.

- [ ] **Step 1: Write the failing test**

Append to `app/src/modules/planner/map/plannerStyle.test.ts`:

```ts
describe('planner-aoi-fill', () => {
  it('exists on the AOI source', () => {
    const style = buildPlannerStyle()
    const fill = style.layers.find((l) => l.id === 'planner-aoi-fill')
    expect(fill).toBeDefined()
    expect(fill?.type).toBe('fill')
    expect((fill as { source?: string }).source).toBe(PLANNER_SOURCES.aoi)
  })

  it('sits below the coverage rings so ring green and gap red read on top', () => {
    const ids = buildPlannerStyle().layers.map((l) => l.id)
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-rings-fill'))
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-gaps-fill'))
  })

  it('keeps the AOI outline above the fill', () => {
    const ids = buildPlannerStyle().layers.map((l) => l.id)
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-aoi-line'))
  })

  it('tints an invalid ring with the alert colour and leaves a valid one neutral', () => {
    const fill = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-fill')
    const paint = (fill as { paint?: Record<string, unknown> }).paint ?? {}
    // ['case', ['==', ['get','valid'], true], <valid>, <invalid>]
    const color = paint['fill-color'] as unknown[]
    expect(color[0]).toBe('case')
    expect(color[2]).toBe('#e8ecf3')
    expect(color[3]).toBe('#ff5a5a')
  })

  it('reads the boolean through an explicit == so MapLibre accepts the case condition', () => {
    // ['get','valid'] alone is typed `value`, not `boolean`, and fails style
    // validation as a `case` condition even though the property is a real
    // boolean.
    const fill = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-fill')
    const paint = (fill as { paint?: Record<string, unknown> }).paint ?? {}
    expect((paint['fill-color'] as unknown[])[1]).toEqual(['==', ['get', 'valid'], true])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/modules/planner/map/plannerStyle.test.ts`

Expected: FAIL with `expect(fill).toBeDefined()` receiving `undefined`.

- [ ] **Step 3: Add the layer**

In `app/src/modules/planner/map/plannerStyle.ts`, insert as the **first** entry of the `layers` array after `...base.layers`, before `planner-rings-fill`:

```ts
      // The AOI's own wash. Without it a committed polygon was a dashed
      // outline over bare map until dock rings greened its interior in --
      // the AOI read as "transparent until you add the first dock".
      //
      // Bottom of the planner block on purpose: coverage green
      // (planner-rings-fill) and gap red (planner-gaps-fill) must read on
      // top of this, not under it.
      //
      // Neutral steel matching planner-aoi-line, so outline and fill read as
      // one object. Not green (that means coverage here) and not red (brand +
      // alerts only, per PRODUCT.md) -- except for an INVALID ring, which
      // computeCoverage excludes from the result entirely, and which is
      // therefore exactly the alert case. That makes the exclusion visible on
      // the map rather than only as the INVALID GEOMETRY badge in the panel.
      //
      // The condition is spelled ['==', ['get','valid'], true] rather than a
      // bare ['get','valid']: `get` is typed `value` by MapLibre's expression
      // checker while `case` requires `boolean`, so the bare form fails style
      // validation even though the underlying property is a real boolean.
      // (planner-docks-circle's ['match', ['get','source'], ...] below is fine
      // because `match` does accept a `value` input.)
      {
        id: 'planner-aoi-fill',
        type: 'fill',
        source: PLANNER_SOURCES.aoi,
        paint: {
          'fill-color': ['case', ['==', ['get', 'valid'], true], '#e8ecf3', '#ff5a5a'],
          'fill-opacity': ['case', ['==', ['get', 'valid'], true], 0.07, 0.14],
        },
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/modules/planner/map/plannerStyle.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Start the dev server (`npm run dev` from `app/`, or the `sentinel-app-dev` launch config), open `/planner`, clear any autosave with `localStorage.removeItem('planner.autosave.v1')` and reload, then `DRAW ▾ → POLYGON` and draw a ring. The interior must be visibly washed **before** any dock is placed. Place a dock inside it and confirm the green coverage ring still reads clearly on top of the wash.

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/planner/map/plannerStyle.ts app/src/modules/planner/map/plannerStyle.test.ts
git commit -m "feat(planner): fill the AOI so a drawn area reads before any dock exists"
```

---

### Task 5: Unify dock and AOI naming

**Files:**
- Modify: `app/src/modules/planner/domain/plan.ts` (append helpers)
- Modify: `app/src/modules/planner/domain/autoPlace.ts:128-138`
- Modify: `app/src/modules/planner/map/useDockPlacement.ts:18-31`, `:101`
- Modify: `app/src/modules/planner/ui/Planner.tsx:120-136` (draw finish), `:193-210` (AOI import)
- Test: `app/src/modules/planner/domain/plan.test.ts`, `domain/autoPlace.test.ts`, `map/useDockPlacement.test.ts:12-37`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all from `@/modules/planner/domain/plan`:
  - `nextDockName(plan: Pick<DeploymentPlan, 'docks'>): string` → `'DOCK 01'`, `'DOCK 02'` …
  - `nextAoiName(plan: Pick<DeploymentPlan, 'aois'>): string` → `'AOI 1'`, `'AOI 2'` …
  - `uniqueName(base: string, taken: readonly string[]): string` → `base`, else `` `${base} (2)` ``, `(3)` …
  - `dockFromClick(lngLat: {lng,lat}, name: string): PlannedDock` — **signature change**, was `(lngLat, seq: number)`.

**Background:** Two dock-naming call sites disagree — `dockFromClick` produces `DOCK 01`, `autoPlace`'s `makeDock` produces `PROPOSED 54.684 24.247`. Both also number off `array.length + 1`, so placing three docks, removing the second and placing another yields two `DOCK 03`s. AOIs have the same `length + 1` collision on the draw path, and KML import reuses the placemark name, so importing one file twice gives two `AOI ONE`s. Dropping `PROPOSED` loses nothing: `source: 'auto'` already drives the `AUTO` badge in `PlanTree` and the `#7aa2f7` marker colour in `plannerStyle.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/modules/planner/domain/plan.test.ts`:

```ts
import { nextDockName, nextAoiName, uniqueName } from './plan'
import type { Aoi, PlannedDock } from './types'

function dockNamed(id: string, name: string): PlannedDock {
  return {
    id,
    name,
    position: [54.6, 24.3],
    dockModel: 'DOCK3',
    droneModel: 'M4TD',
    environment: 'rural',
    source: 'manual',
  }
}

function aoiNamed(id: string, name: string): Aoi {
  return {
    id,
    name,
    source: 'drawn',
    valid: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.7, 24.4],
          [54.5, 24.2],
        ],
      ],
    },
  }
}

describe('nextDockName', () => {
  it('starts at DOCK 01 on an empty plan', () => {
    expect(nextDockName({ docks: [] })).toBe('DOCK 01')
  })

  it('zero-pads to two digits', () => {
    expect(nextDockName({ docks: [dockNamed('d1', 'DOCK 01')] })).toBe('DOCK 02')
  })

  it('numbers from the highest existing number, not the array length', () => {
    // The bug: length+1 after a removal collides. DOCK 01 + DOCK 03 is length
    // 2, so length+1 would mint a second DOCK 03.
    const docks = [dockNamed('d1', 'DOCK 01'), dockNamed('d3', 'DOCK 03')]
    expect(nextDockName({ docks })).toBe('DOCK 04')
  })

  it('ignores renamed docks that do not match the pattern', () => {
    const docks = [dockNamed('d1', 'JEBEL ALI NORTH'), dockNamed('d2', 'DOCK 07')]
    expect(nextDockName({ docks })).toBe('DOCK 08')
  })

  it('does not zero-pad past two digits', () => {
    expect(nextDockName({ docks: [dockNamed('d1', 'DOCK 99')] })).toBe('DOCK 100')
  })
})

describe('nextAoiName', () => {
  it('starts at AOI 1', () => {
    expect(nextAoiName({ aois: [] })).toBe('AOI 1')
  })

  it('numbers from the highest existing number, not the array length', () => {
    const aois = [aoiNamed('a1', 'AOI 1'), aoiNamed('a3', 'AOI 3')]
    expect(nextAoiName({ aois })).toBe('AOI 4')
  })

  it('ignores imported names that do not match the pattern', () => {
    expect(nextAoiName({ aois: [aoiNamed('a1', 'AOI ONE')] })).toBe('AOI 1')
  })
})

describe('uniqueName', () => {
  it('leaves a name that collides with nothing untouched', () => {
    expect(uniqueName('AOI ONE', ['AOI TWO'])).toBe('AOI ONE')
  })

  it('suffixes a collision', () => {
    expect(uniqueName('AOI ONE', ['AOI ONE'])).toBe('AOI ONE (2)')
  })

  it('keeps counting past an existing suffix', () => {
    expect(uniqueName('AOI ONE', ['AOI ONE', 'AOI ONE (2)'])).toBe('AOI ONE (3)')
  })

  it('handles an empty taken list', () => {
    expect(uniqueName('IMPORTED AREA', [])).toBe('IMPORTED AREA')
  })
})
```

Append to `app/src/modules/planner/domain/autoPlace.test.ts`:

```ts
describe('suggestLayout dock naming', () => {
  it('names auto-placed docks with the same DOCK NN convention as manual placement', () => {
    // A square AOI big enough that the greedy loop places at least one dock.
    const aoi: Aoi = {
      id: 'a1',
      name: 'BOX',
      source: 'drawn',
      valid: true,
      geometry: {
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
      },
    }
    const result = suggestLayout(addAoi(createPlan(), aoi))
    expect(result.docks.length).toBeGreaterThan(0)
    for (const d of result.docks) {
      expect(d.name).toMatch(/^DOCK \d{2,}$/)
      expect(d.name).not.toContain('PROPOSED')
      // Provenance stays on `source`, which already drives PlanTree's AUTO
      // badge and plannerStyle's #7aa2f7 marker colour.
      expect(d.source).toBe('auto')
    }
  })

  it('numbers its own run from 01 upward without gaps', () => {
    const aoi: Aoi = {
      id: 'a1',
      name: 'BOX',
      source: 'drawn',
      valid: true,
      geometry: {
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
      },
    }
    const result = suggestLayout(addAoi(createPlan(), aoi))
    expect(result.docks.map((d) => d.name)).toEqual(
      result.docks.map((_, i) => `DOCK ${String(i + 1).padStart(2, '0')}`),
    )
  })
})
```

Add `addAoi` and `createPlan` to that file's imports from `./plan` and `Aoi` to its type imports if not already present.

Replace the four `dockFromClick` tests in `app/src/modules/planner/map/useDockPlacement.test.ts:12-37` with:

```ts
describe('dockFromClick', () => {
  beforeEach(() => resetIdsForTest())

  it('creates a manual dock at the clicked position with the name it is given', () => {
    const d = dockFromClick({ lng: 54.6, lat: 24.3 }, 'DOCK 01')
    expect(d.position).toEqual([54.6, 24.3])
    expect(d.source).toBe('manual')
    expect(d.name).toBe('DOCK 01')
  })

  it('auto-detects urban placement from the position', () => {
    // Abu Dhabi Corniche is inside an URBAN_CENTERS circle in the sim's
    // dock range model, so a dock dropped there defaults to urban (3km).
    const d = dockFromClick({ lng: 54.349, lat: 24.477 }, 'DOCK 01')
    expect(d.environment).toBe('urban')
  })

  it('defaults to rural in open desert', () => {
    const d = dockFromClick({ lng: 53.0, lat: 23.2 }, 'DOCK 01')
    expect(d.environment).toBe('rural')
  })

  it('does not invent a name of its own', () => {
    // Naming moved to nextDockName(plan) so both the manual and auto paths
    // agree and neither can collide after a removal.
    expect(dockFromClick({ lng: 54.6, lat: 24.3 }, 'JEBEL ALI NORTH').name).toBe(
      'JEBEL ALI NORTH',
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/modules/planner/domain/plan.test.ts src/modules/planner/domain/autoPlace.test.ts src/modules/planner/map/useDockPlacement.test.ts`

Expected: FAIL — the three helpers do not exist, `autoPlace` still emits `PROPOSED …`, and `dockFromClick`'s second argument is still a number.

- [ ] **Step 3: Add the naming helpers**

Append to `app/src/modules/planner/domain/plan.ts`:

```ts
// ---------------------------------------------------------------------------
// Naming.
//
// Both dock-creation paths used to name independently -- map/useDockPlacement's
// `DOCK NN` and autoPlace's `PROPOSED <lon> <lat>` -- and both numbered off
// `array.length + 1`, which collides after a removal: DOCK 01 + DOCK 03 is
// length 2, so length+1 mints a SECOND DOCK 03. Numbering off the highest
// number actually present cannot collide, whatever has been removed or renamed.
//
// These are explicit helpers rather than logic inside addAoi/addDock on
// purpose: handleImportPlanFile and loadAutosave reach the store through
// setPlan, not through those setters, so a rename hidden inside addAoi would
// silently apply to KML import and not to plan import. Imported and autosaved
// plans keep their names verbatim -- renaming a user's saved plan on load
// would be a data change wearing a polish fix's clothes.
// ---------------------------------------------------------------------------

function highestNumbered(names: readonly string[], pattern: RegExp): number {
  let max = 0
  for (const name of names) {
    const m = pattern.exec(name.trim())
    if (!m) continue
    const n = Number(m[1])
    if (Number.isSafeInteger(n) && n > max) max = n
  }
  return max
}

const DOCK_NAME_RE = /^DOCK\s+(\d+)$/i
const AOI_NAME_RE = /^AOI\s+(\d+)$/i

// `DOCK 01`, `DOCK 02`, ... Zero-padded to two digits so a dock list sorts and
// aligns; three-digit plans simply grow past the padding.
export function nextDockName(plan: Pick<DeploymentPlan, 'docks'>): string {
  const n = highestNumbered(
    plan.docks.map((d) => d.name),
    DOCK_NAME_RE,
  ) + 1
  return `DOCK ${String(n).padStart(2, '0')}`
}

// `AOI 1`, `AOI 2`, ... Unpadded, matching the label the draw path has always
// produced. Imported names like `AOI ONE` do not match the pattern and so
// never contribute to the count.
export function nextAoiName(plan: Pick<DeploymentPlan, 'aois'>): string {
  return `AOI ${highestNumbered(plan.aois.map((a) => a.name), AOI_NAME_RE) + 1}`
}

// For names the app does not generate and should preserve where it can -- a
// KML placemark's own name, above all. Importing one file twice used to yield
// two identically-named areas, indistinguishable in the plan tree.
export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} (${n})`)) n += 1
  return `${base} (${n})`
}
```

- [ ] **Step 4: Rename auto-placed docks**

In `app/src/modules/planner/domain/autoPlace.ts`, change `makeDock` to take a sequence number and use the shared convention. Replace the function:

```ts
// `seq` is this RUN's 1-based index, not a plan-wide count: suggestLayout
// returns a complete replacement array (setDocks), so the first dock of a run
// is always DOCK 01. Naming matches the manual path (nextDockName) rather than
// the old `PROPOSED <lon> <lat>`, which was both unlike every other dock name
// and unreadable in the one field the user is expected to edit. Provenance
// lives on `source: 'auto'`, which already drives PlanTree's AUTO badge and
// plannerStyle's #7aa2f7 marker colour -- a name is an identity, a source is a
// state.
function makeDock(lon: number, lat: number, droneModel: DroneModelId, seq: number): PlannedDock {
  return {
    id: nextId('dock'),
    name: `DOCK ${String(seq).padStart(2, '0')}`,
    position: [lon, lat],
    dockModel: dockModelFor(droneModel),
    droneModel,
    environment: environmentAt(lon, lat),
    source: 'auto',
  }
}
```

Then find every `makeDock(` call inside `suggestLayout` and pass the run index. Read the surrounding code first: docks are accumulated into an array, so the correct argument is that array's length plus one at the moment of the call (e.g. `makeDock(lon, lat, droneModel, placed.length + 1)`). This is safe here — unlike the plan-wide case, the run's array only grows.

- [ ] **Step 5: Change `dockFromClick` to take a name**

In `app/src/modules/planner/map/useDockPlacement.ts`, replace the function:

```ts
// Takes the resolved name rather than a sequence number: the caller holds the
// plan, and naming now comes from domain/plan.ts's nextDockName so the manual
// and auto paths cannot drift apart or collide after a removal. Previously
// this built `DOCK ${seq}` from a `plan.docks.length + 1` the caller computed,
// which is exactly the colliding form.
export function dockFromClick(lngLat: LngLatLike, name: string): PlannedDock {
  const coords: [number, number] = [lngLat.lng, lngLat.lat]
  return {
    id: nextId('dock'),
    name,
    position: coords,
    dockModel: 'DOCK3',
    droneModel: 'M4TD',
    // Reuse the simulation's own urban-centre model so a planner ring matches
    // a console ring for the same location.
    environment: DOCK_RANGE.isUrbanDock({ coords }) ? 'urban' : 'rural',
    source: 'manual',
  }
}
```

Update the call site at `:101` and the import:

```ts
import { addDock, nextDockName, nextId, updateDock } from '../domain/plan'
```

```ts
      const state = usePlanStore.getState()
      state.setPlan(addDock(state.plan, dockFromClick(e.lngLat, nextDockName(state.plan))))
```

- [ ] **Step 6: Fix the two AOI naming call sites**

In `app/src/modules/planner/ui/Planner.tsx`, in `handleDrawFinish`, replace the `name` line:

```ts
      name: nextAoiName(state.plan),
```

In `handleImportAoiFile`, dedupe against the names already in the plan as each area is added:

```ts
    const state = usePlanStore.getState()
    let next = state.plan
    for (const aoi of result.aois) {
      // Importing one file twice used to produce two identically-named areas.
      // Deduped against the names already in the plan AND the ones added
      // earlier in this same loop, so a file containing two same-named
      // placemarks is handled too.
      const taken = next.aois.map((a) => a.name)
      next = addAoi(next, { ...aoi, name: uniqueName(aoi.name, taken) })
    }
    state.setPlan(next)
```

Update the import:

```ts
import { addAoi, adoptIdsFrom, nextAoiName, nextId, setDocks, uniqueName } from '@/modules/planner/domain/plan'
```

`nextId` may become unused in this file once `handleDrawFinish` still uses it for the AOI id — check and keep it only if referenced, since `lint` fails on unused imports.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd app && npm run test`

Expected: PASS. Watch for `planner.integration.test.ts` and `planIo.test.ts`, which may assert dock names produced through these paths; update any that pin `PROPOSED …` to the new convention.

- [ ] **Step 8: Commit**

```bash
git add app/src/modules/planner/domain/plan.ts app/src/modules/planner/domain/plan.test.ts app/src/modules/planner/domain/autoPlace.ts app/src/modules/planner/domain/autoPlace.test.ts app/src/modules/planner/map/useDockPlacement.ts app/src/modules/planner/map/useDockPlacement.test.ts app/src/modules/planner/ui/Planner.tsx
git commit -m "fix(planner): one dock naming convention, and no colliding AOI names"
```

---

### Task 6: Replace the radius number box with a kilometre slider

**Files:**
- Modify: `app/src/modules/planner/ui/Inspector.tsx:75-89` (handler), `:155-176` (markup)
- Modify: `app/src/modules/planner/ui/planner.css` (reset button style)
- Test: `app/src/modules/planner/ui/Inspector.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exports. `DockInspector` renders a slider labelled `Coverage radius` and a `RESET TO DERIVED` button.

**Background:** The radius already exists as `PlannedDock.radiusKmOverride`, rendered as a bare `type="number"` input labelled "Radius override KM (blank = derived)". The user asked for a slider. `effectiveRadius(dock)` returns `{ radiusKm, enduranceKm, capKm, bound }` where `bound` is `'endurance' | 'cap' | 'override'`. Current catalog figures put endurance around 12.9 km for the M4TD against a 3 km urban / 5 km rural cap, so the cap normally binds. A slider has no empty state, so `RESET TO DERIVED` is the only way back to a derived radius once the slider is touched — without it the derived value becomes unreachable.

- [ ] **Step 1: Write the failing test**

Append to `app/src/modules/planner/ui/Inspector.test.tsx`:

```tsx
import { effectiveRadius } from '../domain/catalog'

describe('Inspector / DockInspector radius slider', () => {
  beforeEach(() => resetIdsForTest())

  it('renders a slider rather than a number box', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const slider = screen.getByLabelText(/Coverage radius/)
    expect(slider).toHaveAttribute('type', 'range')
  })

  it('shows the derived radius when no override is set', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const derived = effectiveRadius(baseDock).radiusKm
    expect(screen.getByLabelText(/Coverage radius/)).toHaveValue(String(derived))
  })

  it('caps the slider at the airframe endurance', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const endurance = effectiveRadius(baseDock).enduranceKm
    expect(screen.getByLabelText(/Coverage radius/)).toHaveAttribute(
      'max',
      String(Math.ceil(endurance)),
    )
  })

  it('writes radiusKmOverride when dragged', () => {
    selectDock(baseDock)
    render(<Inspector />)
    fireEvent.change(screen.getByLabelText(/Coverage radius/), { target: { value: '4.5' } })
    expect(usePlanStore.getState().plan.docks[0].radiusKmOverride).toBe(4.5)
  })

  it('reports MANUAL OVERRIDE once dragged', () => {
    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    expect(screen.getByText(/MANUAL OVERRIDE/)).toBeInTheDocument()
    expect(screen.getByText('4.50 KM')).toBeInTheDocument()
  })

  it('offers RESET TO DERIVED only while an override is set', () => {
    selectDock(baseDock)
    const { unmount } = render(<Inspector />)
    expect(screen.queryByRole('button', { name: /RESET TO DERIVED/ })).not.toBeInTheDocument()
    unmount()

    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    expect(screen.getByRole('button', { name: /RESET TO DERIVED/ })).toBeInTheDocument()
  })

  it('clears the override back to derived', () => {
    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    fireEvent.click(screen.getByRole('button', { name: /RESET TO DERIVED/ }))
    expect(usePlanStore.getState().plan.docks[0].radiusKmOverride).toBeUndefined()
  })

  it('extends the slider max rather than lying about an out-of-range stored override', () => {
    // parsePlan deliberately does not validate radiusKmOverride, so an
    // imported or hand-edited plan can carry a value beyond the airframe's
    // reach. The control must show what is stored, not silently clamp it --
    // the same principle as the incompatible-drone option above.
    selectDock({ ...baseDock, radiusKmOverride: 40 })
    render(<Inspector />)
    const slider = screen.getByLabelText(/Coverage radius/)
    expect(slider).toHaveAttribute('max', '40')
    expect(slider).toHaveValue('40')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/modules/planner/ui/Inspector.test.tsx`

Expected: FAIL — `getByLabelText(/Coverage radius/)` finds nothing; the current label is "Radius override KM (blank = derived)".

- [ ] **Step 3: Replace the handler**

In `app/src/modules/planner/ui/Inspector.tsx`, replace `handleOverride` with:

```ts
  // A range input always reports a parseable number in its value, so the
  // NaN guard the old number box needed (a bare "-" or "." mid-typing) has no
  // equivalent here. Clearing the override is a separate, explicit action --
  // see handleResetRadius.
  function handleRadius(e: ChangeEvent<HTMLInputElement>) {
    patchDock(dockId, { radiusKmOverride: Number(e.target.value) })
  }
  function handleResetRadius() {
    patchDock(dockId, { radiusKmOverride: undefined })
  }
```

- [ ] **Step 4: Replace the markup**

Replace the `Radius override KM` `<label>` block and the `.pl-radius` block with:

```tsx
      <label className="pl-field">
        <span className="lbl">Coverage radius · {breakdown.radiusKm.toFixed(2)} KM</span>
        <input
          className="pl-slider"
          type="range"
          min={0}
          step={0.1}
          // The airframe's physical reach is the ceiling: a planning tool
          // should not let you draw a ring the aircraft cannot fly. One
          // exception -- parsePlan deliberately does not validate this field
          // (see planIo.ts), so an imported or hand-edited plan can carry a
          // larger value. Extend the max to it rather than clamping, so the
          // control shows what is actually stored. Same principle as the
          // incompatible-drone <option> above: never display a value other
          // than the one the plan holds.
          max={Math.max(Math.ceil(breakdown.enduranceKm), Math.ceil(dock.radiusKmOverride ?? 0))}
          value={breakdown.radiusKm}
          onChange={handleRadius}
        />
      </label>

      <div className="pl-radius">
        <div className="pl-radius-val">{breakdown.radiusKm.toFixed(2)} KM</div>
        <div className="lbl">BOUND BY {boundLabel}</div>
        {breakdown.bound === 'cap' ? (
          <div className="lbl pl-radius-headroom">
            AIRFRAME REACHES {breakdown.enduranceKm.toFixed(2)} KM ·{' '}
            {(breakdown.enduranceKm - breakdown.capKm).toFixed(2)} KM HEADROOM UNUSED
          </div>
        ) : null}
        {dock.radiusKmOverride != null ? (
          // A slider has no empty state, so this is the only way back to the
          // derived radius. The old number input got it for free by being
          // cleared; without this the derived value is unreachable once the
          // slider is touched.
          <button type="button" className="pl-reset-btn" onClick={handleResetRadius}>
            RESET TO DERIVED
          </button>
        ) : null}
      </div>
```

- [ ] **Step 5: Style the reset button**

In `app/src/modules/planner/ui/planner.css`, after the `.pl-radius-headroom` rule, add:

```css
/* Secondary to .pl-remove-btn: clearing a radius override is a small
   correction, not a destructive action, so it stays a quiet ghost control. */
.pl-reset-btn {
  margin-top: 10px;
  background: none;
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 7px 10px;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  font-weight: 700;
  cursor: pointer;
}
.pl-reset-btn:hover {
  border-style: solid;
  color: #fff;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app && npx vitest run src/modules/planner/ui/Inspector.test.tsx`

Expected: PASS. If an existing test in this file asserts the old `Radius override KM` label, update it to the new label — it pins the control being replaced.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/planner/ui/Inspector.tsx app/src/modules/planner/ui/Inspector.test.tsx app/src/modules/planner/ui/planner.css
git commit -m "feat(planner): set a dock coverage radius with a km slider"
```

---

### Task 7: Select docks and areas by clicking the map

**Files:**
- Create: `app/src/modules/planner/map/usePlannerSelection.ts`
- Create: `app/src/modules/planner/map/usePlannerSelection.test.ts`
- Modify: `app/src/modules/planner/ui/Planner.tsx` (wire the hook)

**Interfaces:**
- Consumes: `'planner-aoi-fill'` from Task 4; `PLANNER_SOURCES` from `plannerStyle`.
- Produces: `usePlannerSelection(mapRef: MutableRefObject<maplibregl.Map | null>, ready: boolean, enabled: boolean): void`.

**Background:** The console has `selection/useMapSelection.ts`: clicking a dock dot selects it, hovering shows a pointer, and the coverage ring is a large forgiving click target because a dot is only a few pixels wide. The planner has none of this — clicking a dock only drags it, and the inspector opens only from a left-panel row. That is why the radius control (Task 6) was unreachable in practice.

Read `app/src/modules/console/selection/useMapSelection.ts` before starting: this hook follows its structure (layer-scoped `map.on`, `propString` narrowing, pointer cursor, `queryRenderedFeatures` precedence) but writes to `usePlanStore.select` instead of `selectEntity`.

Two hazards:
1. `useDockPlacement` registers `mousedown`/`mousemove`/`mouseup` for dragging, and MapLibre fires a `click` after a drag. A drag that *moved* must not also select. This hook tracks pointer movement between `mousedown` and `mouseup` and suppresses the following click when it exceeded a small pixel threshold.
2. Draw mode and armed dock placement already own the click. `enabled` is `drawMode === 'idle' && !placing`, matching the `Important 5`/`Minor 6` gating discipline in `useDockPlacement.ts`.

- [ ] **Step 1: Write the failing test**

Create `app/src/modules/planner/map/usePlannerSelection.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { usePlannerSelection } from './usePlannerSelection'
import { resetIdsForTest, createPlan, addDock } from '../domain/plan'
import { usePlanStore } from '../store/planStore'
import type { PlannedDock } from '../domain/types'

// Layer-scoped handlers: unlike useDockPlacement's fake map, this hook calls
// the 3-arg map.on(type, layerId, cb) form, so handlers are keyed by
// "type:layerId". A bare 2-arg on() (the plain map click that clears
// selection) is keyed by type alone.
type Handler = (e: unknown) => void

function makeFakeMap() {
  const handlers = new Map<string, Set<Handler>>()
  const canvas = { style: { cursor: '' } }
  const queryRenderedFeatures = vi.fn().mockReturnValue([])

  function key(type: string, layer?: string): string {
    return layer ? `${type}:${layer}` : type
  }

  const mapLike = {
    style: {},
    queryRenderedFeatures,
    getLayer: vi.fn((id: string) => ({ id })),
    getCanvas: () => canvas,
    on: vi.fn((type: string, a: string | Handler, b?: Handler) => {
      const layer = typeof a === 'string' ? a : undefined
      const cb = (typeof a === 'string' ? b : a) as Handler
      const k = key(type, layer)
      const set = handlers.get(k) ?? new Set<Handler>()
      set.add(cb)
      handlers.set(k, set)
    }),
    off: vi.fn((type: string, a: string | Handler, b?: Handler) => {
      const layer = typeof a === 'string' ? a : undefined
      const cb = (typeof a === 'string' ? b : a) as Handler
      handlers.get(key(type, layer))?.delete(cb)
    }),
  }

  return {
    map: mapLike as unknown as maplibregl.Map,
    canvas,
    queryRenderedFeatures,
    on: mapLike.on,
    off: mapLike.off,
    fire(type: string, layer: string | undefined, e: unknown) {
      handlers.get(key(type, layer))?.forEach((h) => h(e))
    },
    handlerCount(): number {
      let n = 0
      for (const set of handlers.values()) n += set.size
      return n
    },
  }
}

const DOCK: PlannedDock = {
  id: 'dock-1',
  name: 'DOCK 01',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural',
  source: 'manual',
}

const pristineStoreState = usePlanStore.getState()

describe('usePlannerSelection', () => {
  let fake: ReturnType<typeof makeFakeMap>
  let mapRef: MutableRefObject<maplibregl.Map | null>

  beforeEach(() => {
    resetIdsForTest()
    fake = makeFakeMap()
    mapRef = { current: fake.map }
    usePlanStore.setState({
      ...pristineStoreState,
      plan: addDock(createPlan(), DOCK),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('selects a dock when its marker is clicked', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-docks-circle', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('selects a dock when its coverage ring is clicked, as the console does', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-rings-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('selects an area when its fill is clicked', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-aoi-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'aoi-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'aoi', id: 'aoi-1' })
  })

  it('lets a dock marker win over the ring beneath it', () => {
    // The ring handler must stand down when the click also landed on a marker,
    // or the two fire for one click. Mirrors useMapSelection's onCoverageClick.
    fake.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    const selectSpy = vi.spyOn(usePlanStore.getState(), 'select')
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', 'planner-rings-fill', {
        point: [10, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('clears the selection when bare map is clicked', () => {
    usePlanStore.setState({ selection: { type: 'dock', id: 'dock-1' } })
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', undefined, { point: [500, 500] })
    })
    expect(usePlanStore.getState().selection).toBeNull()
  })

  it('does not clear when the bare-map click landed on a planner feature', () => {
    usePlanStore.setState({ selection: { type: 'dock', id: 'dock-1' } })
    fake.queryRenderedFeatures.mockReturnValue([{ properties: { id: 'dock-1' } }])
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('click', undefined, { point: [10, 10] })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('shows a pointer cursor over a dock and restores it on leave', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => fake.fire('mouseenter', 'planner-docks-circle', {}))
    expect(fake.canvas.style.cursor).toBe('pointer')
    act(() => fake.fire('mouseleave', 'planner-docks-circle', {}))
    expect(fake.canvas.style.cursor).toBe('')
  })

  it('does not select on the click that ends a drag which actually moved', () => {
    // useDockPlacement commits a drag on mouseup, and MapLibre fires a click
    // after it. Selecting there would fight the drag.
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('mousedown', undefined, { point: { x: 10, y: 10 } })
      fake.fire('mouseup', undefined, { point: { x: 40, y: 40 } })
      fake.fire('click', 'planner-docks-circle', {
        point: [40, 40],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toBeNull()
  })

  it('does select on a click with no movement, which is a plain click not a drag', () => {
    renderHook(() => usePlannerSelection(mapRef, true, true))
    act(() => {
      fake.fire('mousedown', undefined, { point: { x: 10, y: 10 } })
      fake.fire('mouseup', undefined, { point: { x: 11, y: 10 } })
      fake.fire('click', 'planner-docks-circle', {
        point: [11, 10],
        features: [{ properties: { id: 'dock-1' } }],
      })
    })
    expect(usePlanStore.getState().selection).toEqual({ type: 'dock', id: 'dock-1' })
  })

  it('registers nothing at all while disabled', () => {
    renderHook(() => usePlannerSelection(mapRef, true, false))
    expect(fake.handlerCount()).toBe(0)
  })

  it('removes every listener it registered on unmount', () => {
    const { unmount } = renderHook(() => usePlannerSelection(mapRef, true, true))
    expect(fake.handlerCount()).toBeGreaterThan(0)
    unmount()
    expect(fake.handlerCount()).toBe(0)
  })

  it('does not throw when cleanup runs against an already torn-down map', () => {
    const { unmount } = renderHook(() => usePlannerSelection(mapRef, true, true))
    // MapLibre's remove() nulls the internal Style isMapUsable probes for.
    delete (fake.map as unknown as { style?: unknown }).style
    expect(() => unmount()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/modules/planner/map/usePlannerSelection.test.ts`

Expected: FAIL — module `./usePlannerSelection` does not exist.

- [ ] **Step 3: Write the hook**

Create `app/src/modules/planner/map/usePlannerSelection.ts`:

```ts
// Map-click selection for the planner, the counterpart to the console's
// selection/useMapSelection.ts. Read that file alongside this one: the
// conventions here -- layer-scoped map.on, checked property reads, a pointer
// cursor on hover, and treating the coverage ring as a large forgiving click
// target because a 5px marker is not one -- are all its, deliberately, so the
// two modules answer a click the same way.
//
// What differs: this writes to the planner's own store (usePlanStore.select)
// rather than going through selectEntity, and it has no camera behaviour. A
// planner user is placing infrastructure on a map they are already looking at;
// flying the camera on every click would fight them.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { usePlanStore } from '../store/planStore'

const DOCK_LAYER = 'planner-docks-circle'
const RING_LAYER = 'planner-rings-fill'
const AOI_LAYER = 'planner-aoi-fill'

// Every planner feature a click can land on, for the bare-map handler's
// "did this click hit anything?" probe.
const HIT_LAYERS = [DOCK_LAYER, RING_LAYER, AOI_LAYER]

// A drag under this many pixels is a click with a shaky hand, not a drag.
// MapLibre's own click-vs-drag threshold is in the same range.
const DRAG_SLOP_PX = 3

// maplibre-gl types feature properties as `{[name: string]: any}`; narrow
// through `unknown` so every read is checked rather than an unsafe `any` flow
// (same helper, same reasoning, as useMapSelection's).
function propString(
  properties: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!properties) return undefined
  const v = properties[key]
  return typeof v === 'string' ? v : undefined
}

function firstId(e: maplibregl.MapLayerMouseEvent): string | undefined {
  return propString(e.features?.[0]?.properties, 'id')
}

// `enabled` is PlannerShell's `drawMode === 'idle' && !placing`. Selection is
// the fourth gesture competing for a click on this map, after draw vertices,
// armed dock placement and dock dragging; the other three already coexist
// through this same gate (see useDockPlacement's drawModeIdle comments), so
// selection takes it too rather than adding handlers that fight for the click.
export function usePlannerSelection(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !enabled || !isMapUsable(map)) return

    // Drag suppression. useDockPlacement commits a dock drag on mouseup, and
    // MapLibre then fires a click at the release point -- which, for a drag
    // that started on a marker, lands on that same marker. Selecting there
    // would mean every drag also re-selected its dock. Tracked here rather
    // than shared with useDockPlacement: this hook must make its own decision
    // even when nothing is being dragged (a plain map pan also ends in a
    // click), and coupling the two hooks through shared mutable state would
    // be worse than each reading the pointer for itself.
    let downAt: { x: number; y: number } | null = null
    let suppressNextClick = false

    const onDown = (e: maplibregl.MapMouseEvent) => {
      downAt = { x: e.point.x, y: e.point.y }
    }
    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!downAt) return
      const dx = e.point.x - downAt.x
      const dy = e.point.y - downAt.y
      suppressNextClick = Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX
      downAt = null
    }

    // Consumes the suppression flag: every click path calls this first, so a
    // suppressed click is swallowed exactly once and the next real click is
    // unaffected.
    const claimClick = (): boolean => {
      if (!suppressNextClick) return true
      suppressNextClick = false
      return false
    }

    const select = (sel: { type: 'aoi' | 'dock'; id: string }) => {
      usePlanStore.getState().select(sel)
    }

    const onDockClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'dock', id })
    }

    // The ring is the forgiving target: a dock marker is 5px wide, and the
    // console makes the same call for the same reason. Stands down when the
    // click also landed on a marker, so the precise handler above takes it and
    // one click never selects twice.
    const onRingClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: [DOCK_LAYER] }).length) return
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'dock', id })
    }

    // Docks and their rings both win over the area beneath them: the specific
    // target beats the general one, the same precedence useMapSelection
    // applies between dots and coverage.
    const onAoiClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: [DOCK_LAYER, RING_LAYER] }).length) return
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'aoi', id })
    }

    // Clicking bare map clears, the console's convention (its OPS button and
    // clearSelection do the same job). Probes for a hit first: MapLibre
    // dispatches the layer-scoped handlers above AND this one for the same
    // click, so without the probe every selection would be cleared immediately
    // after being made.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const present = HIT_LAYERS.filter((id) => !!map.getLayer(id))
      if (present.length && map.queryRenderedFeatures(e.point, { layers: present }).length) return
      if (!claimClick()) return
      usePlanStore.getState().select(null)
    }

    const setCursor = (cursor: string) => {
      map.getCanvas().style.cursor = cursor
    }
    const onEnter = () => setCursor('pointer')
    const onLeave = () => setCursor('')

    map.on('mousedown', onDown)
    map.on('mouseup', onUp)
    map.on('click', onMapClick)
    map.on('click', DOCK_LAYER, onDockClick)
    map.on('click', RING_LAYER, onRingClick)
    map.on('click', AOI_LAYER, onAoiClick)
    for (const layer of HIT_LAYERS) {
      map.on('mouseenter', layer, onEnter)
      map.on('mouseleave', layer, onLeave)
    }

    return () => {
      // Captured `map`, not mapRef.current: MapView's cleanup runs first on
      // route navigation and nulls the ref, so re-reading it here would only
      // ever see null. map.remove() nulls the instance's internal Style, which
      // is what isMapUsable detects. Same reasoning as useDockPlacement's and
      // useAoiDraw's cleanups.
      if (!isMapUsable(map)) return
      map.off('mousedown', onDown)
      map.off('mouseup', onUp)
      map.off('click', onMapClick)
      map.off('click', DOCK_LAYER, onDockClick)
      map.off('click', RING_LAYER, onRingClick)
      map.off('click', AOI_LAYER, onAoiClick)
      for (const layer of HIT_LAYERS) {
        map.off('mouseenter', layer, onEnter)
        map.off('mouseleave', layer, onLeave)
      }
      // Never leave a pointer cursor stranded on a map this hook no longer
      // manages.
      setCursor('')
    }
  }, [mapRef, ready, enabled])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/modules/planner/map/usePlannerSelection.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Wire it into PlannerShell**

In `app/src/modules/planner/ui/Planner.tsx`, add the import:

```ts
import { usePlannerSelection } from '@/modules/planner/map/usePlannerSelection'
```

and call it after the `dockPlacement` declaration (it needs both pieces of state):

```ts
  // Selection is the fourth gesture competing for a map click, after draw
  // vertices, armed placement and dock dragging. Gated on the other three
  // being stood down -- the same "one active capture mode at a time" rule
  // handleSetDrawMode / handleToggleDockPlacement already keep between
  // themselves.
  usePlannerSelection(mapRef, ready, drawMode === 'idle' && !dockPlacement.placing)
```

- [ ] **Step 6: Verify in the browser**

With the dev server running, open `/planner`, draw an AOI and place two docks. Confirm: clicking a dock opens its inspector with the radius slider; dragging a dock does **not** change the selection; clicking inside a coverage ring but not on the marker selects that dock; clicking inside the AOI away from any ring selects the area; clicking empty map clears; the cursor turns to a pointer over docks, rings and the AOI. Then arm `+ DOCK` and confirm clicking a dock places a new dock rather than selecting, and pick `DRAW ▾ → POLYGON` and confirm clicks become vertices rather than selections.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd app && npm run test && npm run typecheck && npm run lint`

```bash
git add app/src/modules/planner/map/usePlannerSelection.ts app/src/modules/planner/map/usePlannerSelection.test.ts app/src/modules/planner/ui/Planner.tsx
git commit -m "feat(planner): select docks and areas by clicking the map"
```

---

### Task 8: Show the selection on the map

**Files:**
- Modify: `app/src/modules/planner/map/plannerStyle.ts` (add `planner-rings-line-hi`)
- Modify: `app/src/modules/planner/map/usePlannerLayers.ts`
- Modify: `app/src/modules/planner/ui/Planner.tsx` (pass selection)
- Test: `app/src/modules/planner/map/plannerStyle.test.ts`, `app/src/modules/planner/map/usePlannerLayers.test.ts`

**Interfaces:**
- Consumes: `'planner-aoi-fill'` (Task 4), `PlannerSelection` from `../store/planStore`.
- Produces: `usePlannerLayers(mapRef, ready, plan, coverage, selection: PlannerSelection): void` — **signature change**, gains a fifth parameter. Layer id `'planner-rings-line-hi'`.

**Background:** Selection currently shows only as a left-panel row border. The console highlights the selected entity on the map by filtering `coverage-line-hi` to its id (`updateLiveLayers.ts:118`). Doing the same here means selection never rebuilds geometry — only a `setFilter` runs.

`usePlannerLayers`'s existing effect keys on `plan.aois`/`plan.docks` specifically so a plan-name keystroke does not rebuild every ring buffer. The selection filter must therefore go in its **own** effect keyed on `selection` alone.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/modules/planner/map/plannerStyle.test.ts`:

```ts
describe('planner-rings-line-hi', () => {
  it('exists on the rings source, above the ordinary ring outline', () => {
    const style = buildPlannerStyle()
    const ids = style.layers.map((l) => l.id)
    expect(ids).toContain('planner-rings-line-hi')
    expect(ids.indexOf('planner-rings-line')).toBeLessThan(ids.indexOf('planner-rings-line-hi'))
  })

  it('starts filtered to nothing, so no ring is highlighted before a selection', () => {
    const hi = buildPlannerStyle().layers.find((l) => l.id === 'planner-rings-line-hi')
    expect((hi as { filter?: unknown }).filter).toEqual(['==', ['get', 'id'], ''])
  })

  it('draws thicker than the ordinary ring outline so it reads as selected', () => {
    const layers = buildPlannerStyle().layers
    const paintOf = (id: string) =>
      (layers.find((l) => l.id === id) as { paint?: Record<string, number> }).paint ?? {}
    expect(paintOf('planner-rings-line-hi')['line-width']).toBeGreaterThan(
      paintOf('planner-rings-line')['line-width'],
    )
  })
})
```

Append to `app/src/modules/planner/map/usePlannerLayers.test.ts` (read the file first for its existing fake-map shape; it needs `setFilter` and `getLayer` added if absent):

```ts
describe('usePlannerLayers selection highlight', () => {
  it('filters the highlight ring to the selected dock', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(mapRef, true, createPlan(), { ok: false, reason: 'no-aoi' }, {
        type: 'dock',
        id: 'dock-7',
      }),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-rings-line-hi', [
      '==',
      ['get', 'id'],
      'dock-7',
    ])
  })

  it('filters the highlight ring to nothing when there is no selection', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(mapRef, true, createPlan(), { ok: false, reason: 'no-aoi' }, null),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-rings-line-hi', ['==', ['get', 'id'], ''])
  })

  it('filters the AOI outline highlight to the selected area', () => {
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    renderHook(() =>
      usePlannerLayers(mapRef, true, createPlan(), { ok: false, reason: 'no-aoi' }, {
        type: 'aoi',
        id: 'aoi-2',
      }),
    )
    expect(fake.setFilter).toHaveBeenCalledWith('planner-aoi-line-hi', [
      '==',
      ['get', 'id'],
      'aoi-2',
    ])
  })

  it('does not rebuild ring geometry when only the selection changes', () => {
    // The load-bearing performance assertion: a selection click must not
    // rebuild N 64-step ring buffers. Same reasoning as Important 8's
    // plan.aois/plan.docks dependency narrowing.
    const fake = makeFakeMap()
    const mapRef = { current: fake.map }
    const plan = createPlan()
    const coverage = { ok: false, reason: 'no-aoi' } as const
    const { rerender } = renderHook(
      ({ selection }) => usePlannerLayers(mapRef, true, plan, coverage, selection),
      { initialProps: { selection: null as PlannerSelection } },
    )
    fake.ringsSetData.mockClear()
    rerender({ selection: { type: 'dock', id: 'dock-1' } })
    expect(fake.ringsSetData).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run src/modules/planner/map/plannerStyle.test.ts src/modules/planner/map/usePlannerLayers.test.ts`

Expected: FAIL — the highlight layers do not exist and `usePlannerLayers` takes four parameters.

- [ ] **Step 3: Add the highlight layers**

In `app/src/modules/planner/map/plannerStyle.ts`, insert `planner-rings-line-hi` immediately after `planner-rings-line`:

```ts
      // The selected dock's ring. Filtered to one id by usePlannerLayers, the
      // same technique the console uses for coverage-line-hi -- so selecting a
      // dock costs one setFilter, never a geometry rebuild.
      //
      // Starts filtered to the empty id rather than being hidden via
      // visibility: one mechanism (the filter) owns what this layer draws, so
      // there is no second piece of state to keep in agreement with it.
      {
        id: 'planner-rings-line-hi',
        type: 'line',
        source: PLANNER_SOURCES.rings,
        filter: ['==', ['get', 'id'], ''],
        paint: { 'line-color': '#3ddc97', 'line-width': 2.5, 'line-opacity': 1 },
      },
```

and insert `planner-aoi-line-hi` immediately after `planner-aoi-line`:

```ts
      // The selected area's outline, same filtered-to-one-id technique.
      // Brighter and solid where the ordinary outline is dashed.
      {
        id: 'planner-aoi-line-hi',
        type: 'line',
        source: PLANNER_SOURCES.aoi,
        filter: ['==', ['get', 'id'], ''],
        paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
      },
```

- [ ] **Step 4: Add the selection effect**

In `app/src/modules/planner/map/usePlannerLayers.ts`, add the import and the fifth parameter, then append a third effect:

```ts
import type { PlannerSelection } from '../store/planStore'
```

```ts
export function usePlannerLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  plan: DeploymentPlan,
  coverage: CoverageResult,
  selection: PlannerSelection,
): void {
```

```ts
  // Its OWN effect, keyed on `selection` alone. Folding this into the effect
  // above would make every selection click rebuild all N ring buffers (64
  // steps each) -- the exact cost Important 8 removed by narrowing that
  // effect's dependencies to plan.aois/plan.docks.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    const dockId = selection?.type === 'dock' ? selection.id : ''
    const aoiId = selection?.type === 'aoi' ? selection.id : ''
    // The empty id matches nothing, which is how "no selection" is expressed
    // -- see the layers' initial filters in plannerStyle.ts.
    if (map.getLayer('planner-rings-line-hi')) {
      map.setFilter('planner-rings-line-hi', ['==', ['get', 'id'], dockId])
    }
    if (map.getLayer('planner-aoi-line-hi')) {
      map.setFilter('planner-aoi-line-hi', ['==', ['get', 'id'], aoiId])
    }
  }, [mapRef, ready, selection])
```

- [ ] **Step 5: Pass the selection in**

In `app/src/modules/planner/ui/Planner.tsx`'s `PlannerShell`, add the subscription and pass it:

```ts
  const selection = usePlanStore((s) => s.selection)
```

```ts
  usePlannerLayers(mapRef, ready, plan, coverage, selection)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app && npm run test && npm run typecheck`

Expected: PASS. Existing `usePlannerLayers` tests calling it with four arguments will fail typecheck — add `null` as the fifth argument to each.

- [ ] **Step 7: Verify in the browser**

Click a dock: its ring brightens and thickens. Click an area: its outline goes solid white. Click empty map: both highlights clear. Select a dock in a plan with ~20 docks and confirm there is no visible stutter (no ring rebuild).

- [ ] **Step 8: Commit**

```bash
git add app/src/modules/planner/map/plannerStyle.ts app/src/modules/planner/map/plannerStyle.test.ts app/src/modules/planner/map/usePlannerLayers.ts app/src/modules/planner/map/usePlannerLayers.test.ts app/src/modules/planner/ui/Planner.tsx
git commit -m "feat(planner): highlight the selected dock or area on the map"
```

---

### Task 9: Keep panel text legible on bright basemaps

**Files:**
- Modify: `app/src/modules/planner/ui/planner.css` (the `:root[data-maplayer=...]` block)

**Interfaces:**
- Consumes: nothing. CSS only, no test.

**Background:** `planner.css` already opaques `.pl-side`/`.pl-rpanel` on the light/sat/terrain basemaps. Browser verification over satellite shows that is not enough: the inner `.pl-panel` tiles keep translucent `var(--panel2)`, and the panel labels, `405.7 KM2` readouts and dock rows wash out against bright imagery. `chrome.css:295-306` carries the console's equivalent rule and its comment explains the intent: the inner translucent tiles are expected to read against an *opaque* backing.

There is no unit test for contrast. This task is verified by screenshot on all four basemaps.

- [ ] **Step 1: Extend the rule**

In `app/src/modules/planner/ui/planner.css`, replace the existing `:root[data-maplayer=...]` block with:

```css
/* Bright-basemap legibility, the planner's counterpart to chrome.css's
   :root[data-maplayer='light'] #side / #rpanel rule. Both panels are
   near-transparent glass by default (var(--panel), 3.5% white) so the dark map
   reads through them. Over the light, sat and terrain rasters that glass
   leaves the light UI text unreadable, so they take the opaque dark backing
   instead.

   The panel backing alone was not enough: the inner .pl-panel tiles and the
   summary strip are themselves translucent, so over satellite imagery the
   micro-labels, the KM2 readouts and the dock rows still washed out. Caught in
   browser verification on the sat basemap, not by any test -- contrast is not
   something the unit tests can see. */
:root[data-maplayer='light'] .pl-side,
:root[data-maplayer='light'] .pl-rpanel,
:root[data-maplayer='sat'] .pl-side,
:root[data-maplayer='sat'] .pl-rpanel,
:root[data-maplayer='terrain'] .pl-side,
:root[data-maplayer='terrain'] .pl-rpanel {
  background: var(--chrome);
}
:root[data-maplayer='light'] .pl-panel,
:root[data-maplayer='sat'] .pl-panel,
:root[data-maplayer='terrain'] .pl-panel {
  background: #12151c;
  border-color: rgba(255, 255, 255, 0.12);
}
:root[data-maplayer='light'] .pl-row,
:root[data-maplayer='sat'] .pl-row,
:root[data-maplayer='terrain'] .pl-row,
:root[data-maplayer='light'] .pl-input,
:root[data-maplayer='sat'] .pl-input,
:root[data-maplayer='terrain'] .pl-input {
  background: #0d1015;
}
/* The strip spans the map between the two panels, so it is glass over the
   raster with nothing behind it at all. */
:root[data-maplayer='light'] .planner-summary,
:root[data-maplayer='sat'] .planner-summary,
:root[data-maplayer='terrain'] .planner-summary {
  background: #12151c;
}
```

- [ ] **Step 2: Verify in the browser on all four basemaps**

With the dev server running and a plan containing an AOI and several docks, cycle `LAYERS · … ▾` through DARK, LIGHT, SATELLITE and TERRAIN. On each, confirm every left-panel micro-label (`PLAN`, `AREAS OF INTEREST`, `DOCKS`, `COVERAGE PARAMETERS`), the `KM2` figures, the dock row `DOCK3 · M4TD` sub-labels, the inspector fields and the summary strip figures are all clearly readable. Take a screenshot of each for the record.

- [ ] **Step 3: Commit**

```bash
git add app/src/modules/planner/ui/planner.css
git commit -m "fix(planner): keep panel tiles and summary strip legible on bright basemaps"
```

---

### Task 10: Stop the planner topbar overflowing on narrow displays

**Files:**
- Modify: `app/src/modules/planner/ui/planner.css` (append media queries)

**Interfaces:**
- Consumes: the topbar order from Task 3. CSS only, no test.

**Background:** Every planner topbar child is `flex: none` with no wrap and no drop-out. Measured at a 1024px viewport: the `← MODULES` link's right edge lands at 1080px, entirely off-screen. The fixed content needs about 1107px. The console handles this with staged `@media` rules (`chrome.css:564-586`) that shed decorative elements first and never drop the only entry point to a feature.

- [ ] **Step 1: Add the staged drop-out**

Append to `app/src/modules/planner/ui/planner.css`:

```css
/* Responsive drop-out, the planner's counterpart to chrome.css:564-586.
   Every child of .pl-topbar is flex:none with no wrap, so without this the row
   simply overflows: measured at a 1024px viewport, `← MODULES` ended at
   1080px, fully off-screen. Shed in order of disposability, and never drop the
   only entry point to a feature -- the same constraint the console's rules
   state. */
@media (max-width: 1500px) {
  .pl-topbar {
    gap: 8px;
  }
  /* The brand's sub-label repeats what the summary strip already shows. */
  .pl-brand .lbl {
    display: none;
  }
}
@media (max-width: 1280px) {
  .pl-topbar {
    gap: 6px;
    padding: 0 10px;
  }
  .pl-btn {
    padding: 7px 9px;
    letter-spacing: 0.06em;
  }
}
@media (max-width: 1120px) {
  /* The offline chip is a status indicator, not a control, and the map itself
     visibly changes when offline -- so it yields before any button does. */
  .pl-chip {
    display: none;
  }
  /* The logo is decoration next to the module title. */
  .pl-logo {
    display: none;
  }
}
```

- [ ] **Step 2: Verify in the browser at three widths**

With the dev server running on `/planner`, resize the window (or use the browser's device toolbar) to 1024, 1280 and 1600px. At each width confirm: no topbar control is clipped or off-screen, `← MODULES` is fully visible and clickable, and `LAYERS · … ▾` still opens its menu with all four rows on screen. Confirm by measuring rather than by eye — in the console, `document.querySelector('.pl-back').getBoundingClientRect().right` must be less than or equal to `innerWidth` at every width.

- [ ] **Step 3: Commit**

```bash
git add app/src/modules/planner/ui/planner.css
git commit -m "fix(planner): shed topbar chrome instead of overflowing below 1500px"
```

---

### Task 11: Whole-branch verification

**Files:** none modified unless a defect is found.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Run the full gate**

Run each and confirm clean:

```bash
cd app && npm run test
```
```bash
cd app && npm run typecheck
```
```bash
cd app && npm run lint
```
```bash
cd app && npm run build
```

Also confirm the legacy suite still passes from the repo root:

```bash
node --test tests/*.test.js
```

- [ ] **Step 2: Verify the cartography fix on both arrival paths**

This is the item with no unit-test coverage, so it must be checked directly. With the dev server running:

1. Open `/planner` cold (new tab, direct URL). In the console run:
   `localStorage.removeItem('planner.autosave.v1')` then reload.
2. Confirm UAE city labels render (ABU DHABI, DUBAI, SHARJAH …) at the default camera.
3. Navigate to `/console`, click ENTER THEATER, wait for the theater to settle, then navigate to `/planner`.
4. Confirm the labels render here too, and that the basemap is whatever `LAYERS` says — not satellite.

Both paths must agree. Before the fix they did not: 0 labels cold, 9 via the console.

- [ ] **Step 3: Walk the planner end to end**

Draw an AOI (filled immediately, before any dock). Import a KML twice and confirm the second import's areas are suffixed `(2)` rather than duplicating a name. Place three docks, remove the middle one, place another, and confirm no two docks share a name. Run `SUGGEST LAYOUT` and confirm auto docks are named `DOCK NN` with `AUTO` badges. Click a dock on the map, drag the radius slider, watch its ring resize live, then `RESET TO DERIVED`. Confirm the selected dock's ring is highlighted. Export the plan, reload the page, import it back, and confirm names, radii and areas all survive.

- [ ] **Step 4: Confirm the console is unchanged**

Open `/console`, enter the theater, and confirm: the topbar reads `LAYERS · DARK`, all four basemaps still switch, `FILTER`/`OPS`/`MISSIONS`/`MEDIA`/`GLOBE` all still work, dock and drone selection still works, and the offline chip is unchanged. Tasks 1, 2 and 3 touched console-owned files.

- [ ] **Step 5: Commit any fixes and report**

If steps 2–4 surface a defect, fix it, add a regression test where one is possible, and commit. Report the verification results — including anything that failed — rather than asserting success without the output.

---

## Self-Review

**Spec coverage.** All ten spec items map to tasks: §4→1, §5→4, §6→6, §7→7, §8→8, §9→2+3, §10→9, §11→10, §12→5. §13 (data flow) is a constraint, held by Task 5's "imported plans keep their names verbatim" and Task 11 Step 3's export/import round-trip. §14's three risks are each addressed: ordering fragility by Task 1's comment plus Task 11 Step 2, click contention by Task 7's gate and drag-suppression tests, the `dockFromClick` signature change by Task 5 Step 1's rewritten assertions. §15's verification list is Task 11.

**Placeholders.** None. Every code step carries the actual code; every command carries its expected result. Three places instruct the implementer to read surrounding code before editing (Task 5 Step 4's `makeDock` call sites, Task 8 Step 1's existing fake map, Task 3 Step 5's JSX move) — these are genuine "the current shape must be read first" cases, and each names exactly what to look for rather than leaving the change unspecified.

**Type consistency.** `nextDockName`/`nextAoiName` take `Pick<DeploymentPlan, …>` in both the helper definition (Task 5 Step 3) and the tests (Step 1), which pass bare `{ docks: [] }`/`{ aois: [] }` objects — compatible. `dockFromClick(lngLat, name: string)` is consistent across Steps 1, 5 and its call site. `usePlannerSelection(mapRef, ready, enabled)` matches between Task 7's test, hook and wiring. `usePlannerLayers`'s fifth parameter is `PlannerSelection` (the exported type from `planStore.ts`, which already includes `null`) in Task 8's test, signature and call site. Layer ids `planner-aoi-fill`, `planner-rings-line-hi` and `planner-aoi-line-hi` are spelled identically in Tasks 4, 7 and 8. `LAYER_LABELS`/`LAYER_ORDER`/`layerButtonLabel` are consistent across Task 2's four files.

One gap found and fixed during review: Task 8's test asserts a `planner-aoi-line-hi` filter, so that layer had to be added in Step 3 alongside `planner-rings-line-hi` — the spec's §8 describes the AOI highlight as a width bump on the existing `planner-aoi-line`, but a filtered layer cannot bump another layer's paint. A separate `-hi` layer is the same technique already used for the rings and for the console's `coverage-line-hi`, so both highlights now work identically rather than by two different mechanisms.
