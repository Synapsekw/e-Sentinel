# Planner Plan Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a planner user save many named deployment plans in the browser and pick between them from a `PLANS ▾` topbar dropdown.

**Architecture:** One `localStorage` key per plan (`planner.library.v1.<planId>`), holding exactly the JSON `serializePlan` already writes, so `domain/planIo.ts`'s existing validation covers library reads with no second format or second validator. A pure storage module (`io/library.ts`) takes an injected `Storage`; a hook (`ui/usePlanLibrary.ts`) joins it to the Zustand plan store; a presentational dropdown (`ui/PlansMenu.tsx`) renders it. Dirty state rides on the existing monotonic `DeploymentPlan.rev` rather than any structural diff.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest + React Testing Library, Vite. Gate is `npm run verify` (lint, typecheck, test, build) run from `app/`.

**Spec:** `docs/superpowers/specs/2026-07-26-planner-plan-library-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/src/modules/planner/domain/plan.ts` | **Modify.** `adoptIdsFrom` also adopts the plan's own id. |
| `app/src/modules/planner/io/library.ts` | **Create.** Storage layer. Pure, injected `Storage`. |
| `app/src/modules/planner/io/library.test.ts` | **Create.** Storage layer tests against a fake `Storage`. |
| `app/src/modules/planner/store/planStore.ts` | **Modify.** Add `savedRev` + `loadPlan`. |
| `app/src/modules/planner/ui/usePlanLibrary.ts` | **Create.** Store ↔ storage wiring, handlers, messages. |
| `app/src/modules/planner/ui/usePlanLibrary.test.ts` | **Create.** Dirty tracking and `savedRev` transitions. |
| `app/src/modules/planner/ui/PlansMenu.tsx` | **Create.** The dropdown. Presentational. |
| `app/src/modules/planner/ui/PlansMenu.test.tsx` | **Create.** Rendering, inline confirms, rename. |
| `app/src/modules/planner/ui/PlannerTopbar.tsx` | **Modify.** Mount `PlansMenu`; drop `IMPORT PLAN`/`EXPORT PLAN` buttons. |
| `app/src/modules/planner/ui/PlannerTopbar.test.tsx` | **Modify.** Button-label list at lines 54-55. |
| `app/src/modules/planner/ui/Planner.tsx` | **Modify.** Scratch key v1→v2 with migration; wire the hook. |
| `app/src/modules/planner/ui/planner.css` | **Modify.** Menu scroll region, plan rows, inline confirm. |

Run every command below from `/Users/danijeljovanovic/Dev/e&_Sentinel/app`.

---

### Task 1: `adoptIdsFrom` adopts the plan's own id

Plan ids come off the same `nextId` counter as AOI and dock ids (`createPlan` calls `nextId('plan')`), but `adoptIdsFrom` scans only `aois` and `docks`. Load a library plan with id `plan-7` and the counter is untouched, so the next `SAVE AS NEW` can mint `plan-3` and silently overwrite a different library entry.

**Files:**
- Modify: `app/src/modules/planner/domain/plan.ts:34-39`
- Test: `app/src/modules/planner/domain/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('adoptIdsFrom', ...)` block in `app/src/modules/planner/domain/plan.test.ts`:

```ts
    it("adopts the plan's own id, not just aoi and dock ids", () => {
      resetIdsForTest()
      // A plan restored from the library: its own id is the highest number in
      // it, and it has no aois or docks at all to carry that number.
      adoptIdsFrom({ id: 'plan-7', aois: [], docks: [] })
      expect(nextId('plan')).toBe('plan-8')
    })

    it('still works when no id is supplied', () => {
      resetIdsForTest()
      adoptIdsFrom({ aois: [], docks: [] })
      expect(nextId('plan')).toBe('plan-1')
    })
```

Make sure `resetIdsForTest` and `nextId` are in the file's import list from `./plan` (it already imports `adoptIdsFrom`).

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/modules/planner/domain/plan.test.ts -t "adopts the plan's own id"`

Expected: FAIL — `expected 'plan-1' to be 'plan-8'`.

- [ ] **Step 3: Widen the signature and fold in the plan id**

Replace `app/src/modules/planner/domain/plan.ts:34-39` with:

```ts
export function adoptIdsFrom(
  plan: Pick<DeploymentPlan, 'aois' | 'docks'> & { id?: string },
): void {
  let maxSeen = -1
  // The plan's OWN id counts too: createPlan mints it with nextId('plan'), so
  // a library plan carrying `plan-7` must move the counter exactly as an
  // `aoi-7` inside it would. Without this, opening a saved plan and then
  // SAVE AS NEW can mint an id that is already a key in the library and
  // overwrite an unrelated entry.
  if (plan.id !== undefined) maxSeen = Math.max(maxSeen, highestSuffix(plan.id))
  for (const aoi of plan.aois) maxSeen = Math.max(maxSeen, highestSuffix(aoi.id))
  for (const dock of plan.docks) maxSeen = Math.max(maxSeen, highestSuffix(dock.id))
  seq = Math.max(seq, maxSeen)
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/domain/plan.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/modules/planner/domain/plan.ts src/modules/planner/domain/plan.test.ts
git commit -m "fix(planner): adoptIdsFrom adopts the plan's own id

Plan ids come off the same nextId counter as aoi and dock ids, but the
scan skipped them. Loading a plan whose id is the highest number in it
left the counter behind, so the next mint could collide with it."
```

---

### Task 2: Library storage — list, read, save, delete

**Files:**
- Create: `app/src/modules/planner/io/library.ts`
- Test: `app/src/modules/planner/io/library.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/modules/planner/io/library.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { LIBRARY_PREFIX, listPlans, readPlan, savePlan, deletePlan, hasPlan } from './library'
import { serializePlan } from '../domain/planIo'
import { createPlan, resetIdsForTest, setNowForTest, resetNowForTest } from '../domain/plan'
import type { DeploymentPlan } from '../domain/types'

// A minimal in-memory Storage. The real localStorage is not used anywhere in
// this suite: the point of injecting Storage is that quota failure and a
// private-window refusal are both reachable from a test.
export function fakeStorage(onSet?: (key: string) => void): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      onSet?.(k)
      map.set(k, v)
    },
  } as Storage
}

function planNamed(name: string, updatedAt: string): DeploymentPlan {
  return { ...createPlan({ name }), updatedAt }
}

describe('plan library storage', () => {
  beforeEach(() => {
    resetIdsForTest()
    resetNowForTest()
  })

  it('round-trips a saved plan', () => {
    const storage = fakeStorage()
    const plan = createPlan({ name: 'ABU DHABI CORRIDOR', customer: 'ADNOC' })
    expect(savePlan(storage, plan)).toEqual({ ok: true })
    const out = readPlan(storage, plan.id)
    if (!out.ok) throw new Error(out.message)
    expect(out.plan).toEqual(plan)
  })

  it('reports a plan that is not in the library', () => {
    const out = readPlan(fakeStorage(), 'plan-999')
    expect(out).toEqual({ ok: false, message: 'PLAN NOT IN LIBRARY' })
  })

  it('lists saved plans most-recently-updated first', () => {
    const storage = fakeStorage()
    savePlan(storage, planNamed('OLDEST', '2026-01-01T00:00:00.000Z'))
    savePlan(storage, planNamed('NEWEST', '2026-03-01T00:00:00.000Z'))
    savePlan(storage, planNamed('MIDDLE', '2026-02-01T00:00:00.000Z'))
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['NEWEST', 'MIDDLE', 'OLDEST'])
  })

  it('never lists or touches keys outside its own prefix', () => {
    const storage = fakeStorage()
    storage.setItem('planner.scratch.v2', '{"plan":{}}')
    storage.setItem('unrelated', 'x')
    savePlan(storage, createPlan({ name: 'MINE' }))
    expect(listPlans(storage).entries).toHaveLength(1)
    expect(storage.getItem('planner.scratch.v2')).toBe('{"plan":{}}')
    expect(storage.getItem('unrelated')).toBe('x')
  })

  it('skips an unreadable entry and counts it rather than dropping it silently', () => {
    const storage = fakeStorage()
    const good = createPlan({ name: 'GOOD' })
    savePlan(storage, good)
    storage.setItem(`${LIBRARY_PREFIX}plan-broken`, 'not json at all')
    const listing = listPlans(storage)
    expect(listing.entries.map((p) => p.name)).toEqual(['GOOD'])
    expect(listing.skipped).toBe(1)
  })

  it('returns a failure instead of throwing when storage is full', () => {
    const storage = fakeStorage((key) => {
      if (key.startsWith(LIBRARY_PREFIX)) throw new DOMException('full', 'QuotaExceededError')
    })
    const result = savePlan(storage, createPlan({ name: 'TOO BIG' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toContain('TOO BIG')
  })

  it('deletes a plan and leaves the rest of the library alone', () => {
    const storage = fakeStorage()
    const a = createPlan({ name: 'A' })
    const b = createPlan({ name: 'B' })
    savePlan(storage, a)
    savePlan(storage, b)
    deletePlan(storage, a.id)
    expect(hasPlan(storage, a.id)).toBe(false)
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['B'])
  })
})
```

Note `setNowForTest` is imported but unused so far; Task 3 uses it. If lint objects at this step, drop it from the import and re-add it in Task 3.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/modules/planner/io/library.test.ts`

Expected: FAIL — `Failed to resolve import "./library"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/modules/planner/io/library.ts`:

```ts
// The plan library's storage layer: many named plans in localStorage, one key
// per plan, keyed by plan id.
//
// A library entry IS a DeploymentPlan serialized by domain/planIo.ts's
// serializePlan and validated on the way back by its parsePlan. There is no
// second format and no second validator, so everything planIo already
// guarantees -- the schemaVersion gate, the coverage-params bounds, per-element
// aoi/dock shape checks, the aoi.valid re-derivation -- covers library reads
// for free, and a file written by EXPORT PLAN loads here unchanged.
//
// One key per plan rather than one array under a single key: a plan carrying
// imported KML can be hundreds of KB, so a save must rewrite only that plan; a
// QuotaExceededError is then scoped to the plan being saved; and one corrupt
// entry cannot take the whole library down.
//
// `Storage` is a parameter, never `window.localStorage` reached for directly,
// so the tests can drive a fake -- which is the only way the quota path and the
// private-window refusal are reachable at all.
import { serializePlan, parsePlan } from '../domain/planIo'
import type { ParseResult } from '../domain/planIo'
import type { DeploymentPlan } from '../domain/types'

export const LIBRARY_PREFIX = 'planner.library.v1.'

export interface LibraryListing {
  entries: DeploymentPlan[]
  skipped: number
}

export type SaveResult = { ok: true } | { ok: false; message: string }

// Collected up front, before any read or removeItem: Storage indices shift
// when an entry is deleted, so iterating and mutating in the same pass would
// skip keys.
function libraryKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && key.startsWith(LIBRARY_PREFIX)) keys.push(key)
  }
  return keys
}

export function listPlans(storage: Storage): LibraryListing {
  const entries: DeploymentPlan[] = []
  let skipped = 0
  for (const key of libraryKeys(storage)) {
    const raw = storage.getItem(key)
    if (raw === null) {
      skipped += 1
      continue
    }
    const result = parsePlan(raw)
    if (result.ok) entries.push(result.plan)
    else skipped += 1
  }
  // ISO-8601 strings sort lexicographically, so no Date parsing is needed. The
  // id tiebreak keeps the order deterministic for plans saved in the same
  // millisecond, which is routine in tests.
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return { entries, skipped }
}

export function readPlan(storage: Storage, id: string): ParseResult {
  const raw = storage.getItem(LIBRARY_PREFIX + id)
  if (raw === null) return { ok: false, message: 'PLAN NOT IN LIBRARY' }
  return parsePlan(raw)
}

export function hasPlan(storage: Storage, id: string): boolean {
  return storage.getItem(LIBRARY_PREFIX + id) !== null
}

export function savePlan(storage: Storage, plan: DeploymentPlan): SaveResult {
  try {
    storage.setItem(LIBRARY_PREFIX + plan.id, serializePlan(plan))
    return { ok: true }
  } catch {
    // QuotaExceededError is a normal outcome for a ~5MB store holding
    // KML-derived geometry, not an exceptional one, so it is returned rather
    // than thrown. The library is left exactly as it was.
    return { ok: false, message: `COULD NOT SAVE "${plan.name}" · BROWSER STORAGE IS FULL` }
  }
}

export function deletePlan(storage: Storage, id: string): void {
  storage.removeItem(LIBRARY_PREFIX + id)
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/io/library.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/planner/io/library.ts src/modules/planner/io/library.test.ts
git commit -m "feat(planner): plan library storage, one localStorage key per plan

Reuses serializePlan/parsePlan wholesale so a library entry and an
EXPORT PLAN file are the same bytes. Storage is injected so the quota
path and the private-window refusal are reachable from tests."
```

---

### Task 3: Library export and import

**Files:**
- Modify: `app/src/modules/planner/io/library.ts`
- Test: `app/src/modules/planner/io/library.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `app/src/modules/planner/io/library.test.ts`:

```ts
describe('whole-library export and import', () => {
  beforeEach(() => {
    resetIdsForTest()
    resetNowForTest()
  })

  it('exports every saved plan in one envelope', () => {
    const storage = fakeStorage()
    savePlan(storage, createPlan({ name: 'A' }))
    savePlan(storage, createPlan({ name: 'B' }))
    const envelope = JSON.parse(exportLibrary(storage, '2026-07-27T00:00:00.000Z')) as {
      libraryVersion: number
      exportedAt: string
      plans: DeploymentPlan[]
    }
    expect(envelope.libraryVersion).toBe(LIBRARY_VERSION)
    expect(envelope.exportedAt).toBe('2026-07-27T00:00:00.000Z')
    expect(envelope.plans.map((p) => p.name).sort()).toEqual(['A', 'B'])
  })

  it('round-trips an exported library into an empty one', () => {
    const source = fakeStorage()
    savePlan(source, createPlan({ name: 'A' }))
    savePlan(source, createPlan({ name: 'B' }))
    const target = fakeStorage()
    expect(importLibrary(target, exportLibrary(source, '2026-07-27T00:00:00.000Z'))).toEqual({
      ok: true,
      imported: 2,
      skipped: 0,
    })
    expect(listPlans(target).entries.map((p) => p.name).sort()).toEqual(['A', 'B'])
  })

  it('merges by plan id, overwriting an entry that is already there', () => {
    const storage = fakeStorage()
    const plan = createPlan({ name: 'ORIGINAL' })
    savePlan(storage, plan)
    const renamed = { ...plan, name: 'RENAMED' }
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [renamed],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 1, skipped: 0 })
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['RENAMED'])
  })

  it('imports the good plans and counts the bad ones', () => {
    const storage = fakeStorage()
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [createPlan({ name: 'GOOD' }), { nonsense: true }, null],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 1, skipped: 2 })
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['GOOD'])
  })

  it('refuses a library from a newer build rather than partially reading it', () => {
    const storage = fakeStorage()
    const envelope = JSON.stringify({ libraryVersion: 99, exportedAt: 'x', plans: [] })
    const result = importLibrary(storage, envelope)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.message).toContain('99')
  })

  it('refuses a file that is not a library at all, writing nothing', () => {
    const storage = fakeStorage()
    expect(importLibrary(storage, 'not json').ok).toBe(false)
    expect(importLibrary(storage, '{"hello":true}').ok).toBe(false)
    expect(listPlans(storage).entries).toHaveLength(0)
  })
})
```

Extend the import at the top of the file to:

```ts
import {
  LIBRARY_PREFIX,
  LIBRARY_VERSION,
  listPlans,
  readPlan,
  savePlan,
  deletePlan,
  hasPlan,
  exportLibrary,
  importLibrary,
} from './library'
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/modules/planner/io/library.test.ts -t "whole-library"`

Expected: FAIL — `LIBRARY_VERSION` / `exportLibrary` / `importLibrary` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `app/src/modules/planner/io/library.ts`:

```ts
// The envelope's own version, deliberately NOT PLAN_SCHEMA_VERSION: the shape
// of the wrapper and the shape of a plan evolve independently, and conflating
// them would force a library-format bump every time a plan field changes. Each
// plan inside still carries and is validated against its own schemaVersion.
export const LIBRARY_VERSION = 1

export type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; message: string }

// `now` is a parameter rather than a `new Date()` read, matching domain/plan.ts's
// setNowForTest philosophy: the export payload stays byte-assertable in tests.
export function exportLibrary(storage: Storage, now: string): string {
  return JSON.stringify(
    {
      libraryVersion: LIBRARY_VERSION,
      exportedAt: now,
      plans: listPlans(storage).entries,
    },
    null,
    2,
  )
}

export function importLibrary(storage: Storage, json: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, message: 'FILE IS NOT VALID JSON' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'FILE IS NOT A PLAN LIBRARY' }
  }
  const envelope = raw as { libraryVersion?: unknown; plans?: unknown }
  if (typeof envelope.libraryVersion !== 'number' || !Array.isArray(envelope.plans)) {
    return { ok: false, message: 'FILE IS NOT A PLAN LIBRARY' }
  }
  if (envelope.libraryVersion > LIBRARY_VERSION) {
    return {
      ok: false,
      message: `LIBRARY VERSION ${envelope.libraryVersion} IS NEWER THAN THIS BUILD`,
    }
  }

  // Each plan is validated individually and the good ones land. This is a
  // DELIBERATE divergence from parsePlan's all-or-nothing stance on a single
  // plan: the elements of one plan are parts of one object, whereas a library
  // is a bag of independent plans, and refusing fifty because one is malformed
  // helps nobody. The skipped count is always reported, never swallowed.
  let imported = 0
  let skipped = 0
  for (const entry of envelope.plans) {
    // Re-stringified so the one validator in the codebase does the work,
    // rather than growing a second object-shaped copy of parsePlan here.
    const result = parsePlan(JSON.stringify(entry))
    if (!result.ok) {
      skipped += 1
      continue
    }
    if (savePlan(storage, result.plan).ok) imported += 1
    else skipped += 1
  }
  return { ok: true, imported, skipped }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/io/library.test.ts`

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/planner/io/library.ts src/modules/planner/io/library.test.ts
git commit -m "feat(planner): whole-library export and import

Merges by plan id. Unlike parsePlan's all-or-nothing stance on one plan,
a partially bad library imports its good plans and reports the count --
a library is a bag of independent plans, not one object."
```

---

### Task 4: `savedRev` in the plan store

**Files:**
- Modify: `app/src/modules/planner/store/planStore.ts`

- [ ] **Step 1: Add the field and the atomic load action**

Replace the whole of `app/src/modules/planner/store/planStore.ts` with:

```ts
import { create } from 'zustand'
import type { CoverageResult, DeploymentPlan } from '../domain/types'
import { createPlan } from '../domain/plan'

export type PlannerSelection = { type: 'aoi' | 'dock'; id: string } | null

interface PlanState {
  plan: DeploymentPlan
  coverage: CoverageResult
  selection: PlannerSelection
  // The plan.rev this plan was last written to the library at, or null if it
  // has never been saved. `dirty` is then plan.rev !== savedRev -- no
  // structural diff, because domain/plan.ts's bump() already guarantees rev
  // increments on every mutation.
  //
  // Session state ABOUT a plan, not content OF one: it lives here rather than
  // on DeploymentPlan so it can never be serialized into an exported file.
  savedRev: number | null
  setPlan(next: DeploymentPlan): void
  setCoverage(next: CoverageResult): void
  select(sel: PlannerSelection): void
  setSavedRev(rev: number | null): void
  loadPlan(next: DeploymentPlan, savedRev: number | null): void
}

// A planner-local store, deliberately NOT a slice of shared/store.ts:
// nothing outside /planner reads a plan, and the plan mutates on every
// interaction. Keeping it separate stops the global store growing a large
// feature-specific surface.
export const usePlanStore = create<PlanState>((set) => ({
  plan: createPlan(),
  coverage: { ok: false, reason: 'no-aoi' },
  selection: null,
  savedRev: null,
  setPlan: (plan) => set({ plan }),
  setCoverage: (coverage) => set({ coverage }),
  select: (selection) => set({ selection }),
  setSavedRev: (savedRev) => set({ savedRev }),
  // Swapping in a whole plan clears the selection in the SAME update. A
  // selection is an id into the plan that is being replaced, so leaving it
  // set would point the Inspector at an aoi/dock that no longer exists.
  loadPlan: (plan, savedRev) => set({ plan, savedRev, selection: null }),
}))
```

- [ ] **Step 2: Verify nothing broke**

Run: `npx vitest run src/modules/planner && npx tsc --noEmit`

Expected: PASS — all existing planner tests still green, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/planner/store/planStore.ts
git commit -m "feat(planner): track savedRev, and load a plan atomically

loadPlan clears the selection in the same update: a selection is an id
into the plan being replaced."
```

---

### Task 5: `usePlanLibrary` hook

**Files:**
- Create: `app/src/modules/planner/ui/usePlanLibrary.ts`
- Test: `app/src/modules/planner/ui/usePlanLibrary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/modules/planner/ui/usePlanLibrary.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlanLibrary } from './usePlanLibrary'
import { usePlanStore } from '../store/planStore'
import { createPlan, addAoi, resetIdsForTest, nextId } from '../domain/plan'
import { listPlans, LIBRARY_PREFIX } from '../io/library'
import type { Aoi } from '../domain/types'

const square: Aoi = {
  id: 'aoi-fixed',
  name: 'AREA',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.0, 24.0],
        [54.1, 24.0],
        [54.1, 24.1],
        [54.0, 24.1],
        [54.0, 24.0],
      ],
    ],
  },
  source: 'drawn',
  valid: true,
}

function clearLibrary() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LIBRARY_PREFIX)) localStorage.removeItem(key)
  }
}

describe('usePlanLibrary', () => {
  beforeEach(() => {
    resetIdsForTest()
    clearLibrary()
    usePlanStore.getState().loadPlan(createPlan({ name: 'WORKING' }), null)
  })

  it('reports an unsaved plan as dirty', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    expect(result.current.dirty).toBe(true)
  })

  it('is clean straight after a save, and dirty again after an edit', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    expect(result.current.dirty).toBe(false)

    act(() => {
      const state = usePlanStore.getState()
      state.setPlan(addAoi(state.plan, square))
    })
    expect(result.current.dirty).toBe(true)
  })

  it('writes the plan into the library on save', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    expect(listPlans(localStorage).entries.map((p) => p.name)).toEqual(['WORKING'])
  })

  it('save as new mints a fresh entry and switches the working plan to it', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const firstId = usePlanStore.getState().plan.id

    act(() => result.current.saveAsNew())
    const secondId = usePlanStore.getState().plan.id

    expect(secondId).not.toBe(firstId)
    expect(listPlans(localStorage).entries).toHaveLength(2)
    // The working plan IS the new entry, and is clean against it.
    expect(result.current.dirty).toBe(false)
  })

  it('dedupes the name so two saves of UNTITLED PLAN are distinguishable', () => {
    usePlanStore.getState().loadPlan(createPlan(), null)
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    act(() => result.current.saveAsNew())
    const names = listPlans(localStorage).entries.map((p) => p.name).sort()
    expect(names).toEqual(['UNTITLED PLAN', 'UNTITLED PLAN (2)'])
  })

  it('opening a plan loads it and reports it clean', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => {
      usePlanStore.getState().loadPlan(createPlan({ name: 'SOMETHING ELSE' }), null)
    })
    act(() => result.current.openPlan(savedId))

    expect(usePlanStore.getState().plan.name).toBe('WORKING')
    expect(result.current.dirty).toBe(false)
  })

  it('deleting the open plan leaves it on screen but marks it unsaved', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.deletePlan(savedId))

    expect(usePlanStore.getState().plan.name).toBe('WORKING')
    expect(result.current.dirty).toBe(true)
    expect(listPlans(localStorage).entries).toHaveLength(0)
  })

  it('duplicating copies the entry without changing what is open', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.duplicatePlan(savedId))

    expect(usePlanStore.getState().plan.id).toBe(savedId)
    expect(listPlans(localStorage).entries.map((p) => p.name).sort()).toEqual([
      'WORKING',
      'WORKING COPY',
    ])
  })

  it('renaming the open plan keeps the working plan name in step', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.renamePlan(savedId, 'RENAMED'))

    expect(usePlanStore.getState().plan.name).toBe('RENAMED')
    expect(listPlans(localStorage).entries.map((p) => p.name)).toEqual(['RENAMED'])
  })

  it('notifies with a message when a save succeeds', () => {
    const notify = vi.fn()
    const { result } = renderHook(() => usePlanLibrary(notify))
    act(() => result.current.savePlan())
    expect(notify).toHaveBeenCalledWith({ level: 'info', text: 'PLAN SAVED' })
  })

  it('mints an id that cannot collide with a plan restored from the library', () => {
    // Regression guard for Task 1: a restored plan whose own id carries the
    // highest counter value must move the counter before anything new is minted.
    const restored = { ...createPlan({ name: 'RESTORED' }), id: 'plan-40' }
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => {
      usePlanStore.getState().loadPlan(restored, 0)
    })
    act(() => result.current.saveAsNew())
    expect(usePlanStore.getState().plan.id).not.toBe('plan-40')
    expect(listPlans(localStorage).entries).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/modules/planner/ui/usePlanLibrary.test.ts`

Expected: FAIL — `Failed to resolve import "./usePlanLibrary"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/modules/planner/ui/usePlanLibrary.ts`:

```ts
// The seam between the plan store and io/library.ts. Owns the listing and its
// refresh, the dirty flag, every library action, and the alert messages those
// actions produce. PlansMenu.tsx stays presentational; Planner.tsx keeps
// rendering the .pl-alert banner it already owns.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlanStore } from '../store/planStore'
import { adoptIdsFrom, nextId, uniqueName } from '../domain/plan'
import {
  listPlans,
  readPlan,
  savePlan as savePlanToStorage,
  deletePlan as deletePlanFromStorage,
  hasPlan,
  exportLibrary,
  importLibrary,
} from '../io/library'
import type { DeploymentPlan } from '../domain/types'

export interface LibraryMessage {
  level: 'error' | 'info'
  text: string
}

export type Notify = (message: LibraryMessage) => void

export interface PlanLibrary {
  entries: DeploymentPlan[]
  skipped: number
  available: boolean
  dirty: boolean
  isSaved(id: string): boolean
  refresh(): void
  savePlan(): void
  saveAsNew(): void
  openPlan(id: string): void
  renamePlan(id: string, name: string): void
  duplicatePlan(id: string): void
  deletePlan(id: string): void
  exportLibraryFile(): void
  importLibraryFile(file: File): Promise<void>
}

// A write probe, not a truthiness check: Safari private browsing exposes a
// localStorage object whose setItem throws, so `window.localStorage != null`
// says nothing useful. Returns null when the library simply cannot work, and
// every action below then reports that rather than throwing.
function resolveStorage(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__planner_library_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

const UNAVAILABLE: LibraryMessage = {
  level: 'error',
  text: 'BROWSER STORAGE UNAVAILABLE · PLANS CANNOT BE SAVED',
}

export function usePlanLibrary(notify: Notify): PlanLibrary {
  const plan = usePlanStore((s) => s.plan)
  const savedRev = usePlanStore((s) => s.savedRev)
  const storage = useMemo(resolveStorage, [])
  const [entries, setEntries] = useState<DeploymentPlan[]>([])
  const [skipped, setSkipped] = useState(0)

  const refresh = useCallback(() => {
    if (!storage) return
    const listing = listPlans(storage)
    setEntries(listing.entries)
    setSkipped(listing.skipped)
  }, [storage])

  useEffect(refresh, [refresh])

  const dirty = savedRev === null || plan.rev !== savedRev

  const write = useCallback(
    (next: DeploymentPlan, successText: string): boolean => {
      if (!storage) {
        notify(UNAVAILABLE)
        return false
      }
      const result = savePlanToStorage(storage, next)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return false
      }
      refresh()
      notify({ level: 'info', text: successText })
      return true
    },
    [storage, notify, refresh],
  )

  const takenNames = useCallback(() => entries.map((e) => e.name), [entries])

  const savePlan = useCallback(() => {
    const current = usePlanStore.getState().plan
    if (write(current, 'PLAN SAVED')) {
      usePlanStore.getState().setSavedRev(current.rev)
    }
  }, [write])

  const saveAsNew = useCallback(() => {
    const current = usePlanStore.getState().plan
    // The working plan BECOMES the new entry. Writing a copy while continuing
    // to edit the original would leave savedRev pointing at an entry the user
    // is no longer editing, which breaks the next SAVE PLAN.
    const next: DeploymentPlan = {
      ...current,
      id: nextId('plan'),
      name: uniqueName(current.name, takenNames()),
    }
    if (write(next, 'PLAN SAVED AS NEW')) {
      usePlanStore.getState().loadPlan(next, next.rev)
    }
  }, [write, takenNames])

  const openPlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      // Same path IMPORT PLAN and the scratch restore already take: adopt the
      // incoming ids into this session's counter before anything mints a new
      // one against the loaded plan.
      adoptIdsFrom(result.plan)
      usePlanStore.getState().loadPlan(result.plan, result.plan.rev)
    },
    [storage, notify],
  )

  const renamePlan = useCallback(
    (id: string, name: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      const renamed = { ...result.plan, name: trimmed }
      if (!write(renamed, 'PLAN RENAMED')) return
      // Keep the working plan's name in step, or the left panel's NAME field
      // would disagree with the library row for the very same plan.
      const current = usePlanStore.getState().plan
      if (current.id === id) usePlanStore.getState().setPlan({ ...current, name: trimmed })
    },
    [storage, notify, write],
  )

  const duplicatePlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      write(
        {
          ...result.plan,
          id: nextId('plan'),
          name: uniqueName(`${result.plan.name} COPY`, takenNames()),
        },
        'PLAN DUPLICATED',
      )
    },
    [storage, notify, write, takenNames],
  )

  const deletePlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      deletePlanFromStorage(storage, id)
      refresh()
      // Deleting the plan that is open does NOT clear the screen -- wiping the
      // user's work as a side effect of housekeeping would be far worse than an
      // open plan with no backing entry. It is simply unsaved again, which is
      // the truth.
      if (usePlanStore.getState().plan.id === id) usePlanStore.getState().setSavedRev(null)
      notify({ level: 'info', text: 'PLAN DELETED' })
    },
    [storage, notify, refresh],
  )

  const exportLibraryFile = useCallback(() => {
    if (!storage) {
      notify(UNAVAILABLE)
      return
    }
    const json = exportLibrary(storage, new Date().toISOString())
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'plan-library.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [storage, notify])

  const importLibraryFile = useCallback(
    async (file: File) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      let text: string
      try {
        text = await file.text()
      } catch (err) {
        console.error('[planner] could not read library file', err)
        notify({ level: 'error', text: 'COULD NOT READ FILE' })
        return
      }
      const result = importLibrary(storage, text)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      refresh()
      notify({
        level: 'info',
        text:
          result.skipped > 0
            ? `${result.imported} IMPORTED · ${result.skipped} SKIPPED`
            : `${result.imported} IMPORTED`,
      })
    },
    [storage, notify, refresh],
  )

  return {
    entries,
    skipped,
    available: storage !== null,
    dirty,
    isSaved: (id: string) => (storage ? hasPlan(storage, id) : false),
    refresh,
    savePlan,
    saveAsNew,
    openPlan,
    renamePlan,
    duplicatePlan,
    deletePlan,
    exportLibraryFile,
    importLibraryFile,
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/ui/usePlanLibrary.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/planner/ui/usePlanLibrary.ts src/modules/planner/ui/usePlanLibrary.test.ts
git commit -m "feat(planner): usePlanLibrary, the store-to-storage seam

Dirty rides on DeploymentPlan.rev. SAVE AS NEW switches the working plan
to the new entry; deleting the open plan leaves it on screen and simply
marks it unsaved."
```

---

### Task 6: `PlansMenu` dropdown

**Files:**
- Create: `app/src/modules/planner/ui/PlansMenu.tsx`
- Test: `app/src/modules/planner/ui/PlansMenu.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/src/modules/planner/ui/PlansMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import PlansMenu from './PlansMenu'
import { createPlan } from '../domain/plan'
import type { PlanLibrary } from './usePlanLibrary'

afterEach(cleanup)

function stubLibrary(over: Partial<PlanLibrary> = {}): PlanLibrary {
  return {
    entries: [],
    skipped: 0,
    available: true,
    dirty: false,
    isSaved: () => false,
    refresh: vi.fn(),
    savePlan: vi.fn(),
    saveAsNew: vi.fn(),
    openPlan: vi.fn(),
    renamePlan: vi.fn(),
    duplicatePlan: vi.fn(),
    deletePlan: vi.fn(),
    exportLibraryFile: vi.fn(),
    importLibraryFile: vi.fn(),
    ...over,
  }
}

function renderOpen(library: PlanLibrary, onClose = vi.fn()) {
  return render(
    <PlansMenu
      open
      onToggle={vi.fn()}
      onClose={onClose}
      library={library}
      onImportPlanFile={vi.fn()}
      onExportPlan={vi.fn()}
    />,
  )
}

describe('PlansMenu', () => {
  it('lists saved plans with their derived metadata', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI', customer: 'ADNOC' }), id: 'plan-1' }
    renderOpen(stubLibrary({ entries: [plan] }))
    expect(screen.getByText('ABU DHABI')).toBeInTheDocument()
    expect(screen.getByText(/ADNOC/)).toBeInTheDocument()
    expect(screen.getByText(/0 AOI/)).toBeInTheDocument()
  })

  it('reads SAVED and disables the save item when the plan is clean', () => {
    renderOpen(stubLibrary({ dirty: false }))
    const save = screen.getByRole('menuitem', { name: /SAVED/ })
    expect(save).toBeDisabled()
  })

  it('saves directly when the plan is not already in the library', () => {
    const savePlan = vi.fn()
    renderOpen(stubLibrary({ dirty: true, isSaved: () => false, savePlan }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'SAVE PLAN' }))
    expect(savePlan).toHaveBeenCalled()
  })

  it('asks before overwriting an entry that already exists', () => {
    const savePlan = vi.fn()
    renderOpen(stubLibrary({ dirty: true, isSaved: () => true, savePlan }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'SAVE PLAN' }))
    expect(savePlan).not.toHaveBeenCalled()
    expect(screen.getByText(/OVERWRITE/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'OVERWRITE' }))
    expect(savePlan).toHaveBeenCalled()
  })

  it('opens a plan immediately when there are no unsaved changes', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const openPlan = vi.fn()
    const onClose = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], dirty: false, openPlan }), onClose)
    fireEvent.click(screen.getByRole('button', { name: /ABU DHABI/ }))
    expect(openPlan).toHaveBeenCalledWith('plan-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before discarding unsaved changes to open another plan', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const openPlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], dirty: true, openPlan }))
    fireEvent.click(screen.getByRole('button', { name: /ABU DHABI/ }))
    expect(openPlan).not.toHaveBeenCalled()
    expect(screen.getByText(/UNSAVED CHANGES/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }))
    expect(openPlan).toHaveBeenCalledWith('plan-1')
  })

  it('asks before deleting, and cancelling leaves the plan alone', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const deletePlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], deletePlan }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete ABU DHABI' }))
    expect(screen.getByText(/DELETE\?/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(deletePlan).not.toHaveBeenCalled()
    expect(screen.getByText('ABU DHABI')).toBeInTheDocument()
  })

  it('commits a rename on Enter and abandons it on Escape', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const renamePlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], renamePlan }))

    fireEvent.click(screen.getByRole('button', { name: 'Rename ABU DHABI' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'DUBAI' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renamePlan).toHaveBeenCalledWith('plan-1', 'DUBAI')

    renamePlan.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Rename ABU DHABI' }))
    const again = screen.getByRole('textbox')
    fireEvent.change(again, { target: { value: 'IGNORED' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(renamePlan).not.toHaveBeenCalled()
  })

  it('says so when browser storage is unavailable', () => {
    renderOpen(stubLibrary({ available: false }))
    expect(screen.getByText(/LIBRARY UNAVAILABLE/)).toBeInTheDocument()
  })

  it('reports unreadable entries rather than hiding them', () => {
    renderOpen(stubLibrary({ entries: [], skipped: 2 }))
    expect(screen.getByText(/2 UNREADABLE/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/modules/planner/ui/PlansMenu.test.tsx`

Expected: FAIL — `Failed to resolve import "./PlansMenu"`.

- [ ] **Step 3: Write the implementation**

Create `app/src/modules/planner/ui/PlansMenu.tsx`:

```tsx
// The PLANS dropdown: save, the list of saved plans, and the four import/export
// items. Presentational -- every action comes in through the `library` prop
// (ui/usePlanLibrary.ts), so this file owns only what the menu looks like and
// which row is currently confirming something.
//
// Confirmation is ALWAYS inline in the affected row, never window.confirm: a
// native modal blocks the event loop, and this app is driven live in front of
// an audience. A destructive click swaps the row's contents in place instead.
//
// Reuses the topbar's existing pl-dropdown / pl-menu / pl-menu-item pattern
// (the one DRAW and LAYERS already use); the list region additionally scrolls,
// exactly as the console's .docks-menu does for the same problem.
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PlanLibrary } from './usePlanLibrary'
import { plural } from './pluralize'

export interface PlansMenuProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
  library: PlanLibrary
  onImportPlanFile: (file: File) => void
  onExportPlan: () => void
}

type Confirm =
  | { kind: 'overwrite' }
  | { kind: 'discard'; id: string }
  | { kind: 'delete'; id: string }
  | null

export default function PlansMenu({
  open,
  onToggle,
  onClose,
  library,
  onImportPlanFile,
  onExportPlan,
}: PlansMenuProps) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const planInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)

  function close() {
    setConfirm(null)
    setRenamingId(null)
    onClose()
  }

  function handleSaveClick() {
    // Only ask when there is genuinely something to overwrite.
    if (library.isSaved(library.currentPlanId)) setConfirm({ kind: 'overwrite' })
    else library.savePlan()
  }

  function handleRowClick(id: string) {
    if (library.dirty) setConfirm({ kind: 'discard', id })
    else {
      library.openPlan(id)
      close()
    }
  }

  function startRename(id: string, name: string) {
    setConfirm(null)
    setRenamingId(id)
    setDraftName(name)
  }

  function commitRename(id: string) {
    if (draftName.trim().length > 0) library.renamePlan(id, draftName)
    setRenamingId(null)
  }

  function handlePlanFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportPlanFile(file)
    close()
  }

  function handleLibraryFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void library.importLibraryFile(file)
    close()
  }

  const saveLabel = library.dirty ? 'SAVE PLAN' : 'SAVED'

  return (
    <>
      <button
        type="button"
        className="pl-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        PLANS ▾
      </button>
      {open ? (
        <div className="pl-menu pl-plans-menu" role="menu">
          {confirm?.kind === 'overwrite' ? (
            <div className="pl-confirm">
              <span className="lbl">OVERWRITE SAVED PLAN?</span>
              <button
                type="button"
                onClick={() => {
                  library.savePlan()
                  setConfirm(null)
                }}
              >
                OVERWRITE
              </button>
              <button type="button" onClick={() => setConfirm(null)}>
                CANCEL
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="pl-menu-item"
              disabled={!library.dirty}
              onClick={handleSaveClick}
            >
              {saveLabel}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              library.saveAsNew()
              setConfirm(null)
            }}
          >
            SAVE AS NEW
          </button>

          <div className="pl-menu-sep" />

          <div className="pl-menu-head lbl">
            {library.available
              ? `SAVED PLANS · ${library.entries.length}${
                  library.skipped > 0 ? ` · ${library.skipped} UNREADABLE` : ''
                }`
              : 'LIBRARY UNAVAILABLE'}
          </div>

          <div className="pl-menu-scroll">
            {library.entries.length === 0 && library.available ? (
              <span className="pl-empty lbl">NO SAVED PLANS</span>
            ) : null}
            {library.entries.map((entry) => {
              if (confirm?.kind === 'discard' && confirm.id === entry.id) {
                return (
                  <div className="pl-confirm" key={entry.id}>
                    <span className="lbl">UNSAVED CHANGES</span>
                    <button
                      type="button"
                      onClick={() => {
                        library.openPlan(entry.id)
                        close()
                      }}
                    >
                      DISCARD
                    </button>
                    <button type="button" onClick={() => setConfirm(null)}>
                      CANCEL
                    </button>
                  </div>
                )
              }
              if (confirm?.kind === 'delete' && confirm.id === entry.id) {
                return (
                  <div className="pl-confirm" key={entry.id}>
                    <span className="lbl">DELETE?</span>
                    <button
                      type="button"
                      onClick={() => {
                        library.deletePlan(entry.id)
                        setConfirm(null)
                      }}
                    >
                      YES
                    </button>
                    <button type="button" onClick={() => setConfirm(null)}>
                      CANCEL
                    </button>
                  </div>
                )
              }
              if (renamingId === entry.id) {
                return (
                  <div className="pl-plan-row" key={entry.id}>
                    <input
                      className="pl-input"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(entry.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  </div>
                )
              }
              return (
                <div className="pl-plan-row" key={entry.id}>
                  <button
                    type="button"
                    className="pl-plan-main"
                    onClick={() => handleRowClick(entry.id)}
                  >
                    <span className="pl-plan-name">{entry.name}</span>
                    <span className="pl-plan-meta">
                      {[
                        entry.customer.trim() || 'NO CUSTOMER',
                        plural(entry.aois.length, 'AOI'),
                        plural(entry.docks.length, 'DOCK'),
                      ].join(' · ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Rename ${entry.name}`}
                    onClick={() => startRename(entry.id, entry.name)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Duplicate ${entry.name}`}
                    onClick={() => library.duplicatePlan(entry.id)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => setConfirm({ kind: 'delete', id: entry.id })}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>

          <div className="pl-menu-sep" />

          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => planInputRef.current?.click()}
          >
            IMPORT PLAN…
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              onExportPlan()
              close()
            }}
          >
            EXPORT PLAN
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => libraryInputRef.current?.click()}
          >
            IMPORT LIBRARY…
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              library.exportLibraryFile()
              close()
            }}
          >
            EXPORT LIBRARY
          </button>

          <input
            ref={planInputRef}
            type="file"
            accept=".json"
            className="pl-hidden-input"
            onChange={handlePlanFile}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept=".json"
            className="pl-hidden-input"
            onChange={handleLibraryFile}
          />
        </div>
      ) : null}
    </>
  )
}
```

`handleSaveClick` above reads `library.currentPlanId`, which does not exist yet. The menu needs the id of the plan currently on screen to know whether `SAVE PLAN` would overwrite an existing entry, and reading the store directly from a presentational component would defeat the point of the `library` prop. So add it to the hook.

In `app/src/modules/planner/ui/usePlanLibrary.ts`, add to the `PlanLibrary` interface immediately after `dirty: boolean`:

```ts
  currentPlanId: string
```

and to the returned object immediately after `dirty,`:

```ts
    currentPlanId: plan.id,
```

In `app/src/modules/planner/ui/PlansMenu.test.tsx`, add to `stubLibrary`'s defaults:

```ts
    currentPlanId: 'plan-current',
```

- [ ] **Step 4: Add the CSS**

Append to `app/src/modules/planner/ui/planner.css`:

```css
/* ---------- PLANS menu (plan library) ---------- */
.pl-plans-menu {
  min-width: 320px;
}
/* The list scrolls while the fixed save/import/export items stay put, so a
   library of thirty plans cannot push EXPORT LIBRARY off the bottom of the
   screen. 65vh matches the console's .docks-menu, which solves the same
   problem for the dock network. */
.pl-menu-scroll {
  max-height: 65vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pl-menu-sep {
  height: 1px;
  background: var(--line);
  margin: 6px 2px;
}
.pl-menu-head {
  padding: 8px 10px 6px;
}
.pl-menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pl-plan-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 8px;
}
.pl-plan-row:hover {
  background: var(--panel2);
}
.pl-plan-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: none;
  border: none;
  text-align: left;
  padding: 9px 10px;
  color: var(--txt);
}
.pl-plan-name {
  font-family: var(--mono);
  font-size: 11.5px;
  color: #fff;
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-plan-meta {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--dim);
  letter-spacing: 0.06em;
}
/* The row actions stay dim until the row is hovered, so a list of plans reads
   as a list of plans rather than a wall of icons. They remain reachable by
   keyboard regardless: :focus-within keeps them visible while tabbing. */
.pl-icon-btn {
  flex: none;
  background: none;
  border: none;
  color: var(--dim);
  font-size: 13px;
  line-height: 1;
  padding: 6px 5px;
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.pl-plan-row:hover .pl-icon-btn,
.pl-plan-row:focus-within .pl-icon-btn {
  opacity: 1;
}
.pl-icon-btn:hover {
  color: #fff;
}
.pl-icon-btn[aria-label^='Delete']:hover {
  color: var(--red);
}

/* Inline confirmation, replacing the row it applies to. Amber, not red: a
   confirm is a question, and red stays reserved for brand and alerts. */
.pl-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
  background: rgba(251, 191, 36, 0.08);
}
.pl-confirm .lbl {
  flex: 1;
  color: var(--amber);
}
.pl-confirm button {
  flex: none;
  background: none;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--txt);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 5px 8px;
}
.pl-confirm button:hover {
  border-color: var(--amber);
  color: #fff;
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/ui/PlansMenu.test.tsx`

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/planner/ui/PlansMenu.tsx src/modules/planner/ui/PlansMenu.test.tsx src/modules/planner/ui/usePlanLibrary.ts src/modules/planner/ui/planner.css
git commit -m "feat(planner): PLANS dropdown for the plan library

Every confirmation is inline in the affected row rather than
window.confirm: a native modal blocks the event loop, and this app is
driven live in front of an audience."
```

---

### Task 7: Scratch key v2 with migration

**Files:**
- Modify: `app/src/modules/planner/ui/Planner.tsx:61-79` and its autosave effect
- Test: `app/src/modules/planner/ui/Planner.test.tsx`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `app/src/modules/planner/ui/Planner.test.tsx`:

```tsx
describe('scratch key migration', () => {
  it('reads a v1 autosave forward into v2 so in-progress work survives an upgrade', () => {
    localStorage.clear()
    const plan = createPlan({ name: 'IN PROGRESS' })
    localStorage.setItem('planner.autosave.v1', JSON.stringify(plan))

    const loaded = loadScratch()

    expect(loaded?.plan.name).toBe('IN PROGRESS')
    // A migrated plan has never been written to the library, so it is unsaved.
    expect(loaded?.savedRev).toBeNull()
  })

  it('prefers v2 when both keys are present', () => {
    localStorage.clear()
    localStorage.setItem('planner.autosave.v1', JSON.stringify(createPlan({ name: 'OLD' })))
    localStorage.setItem(
      'planner.scratch.v2',
      JSON.stringify({ plan: createPlan({ name: 'NEW' }), savedRev: 3 }),
    )

    const loaded = loadScratch()

    expect(loaded?.plan.name).toBe('NEW')
    expect(loaded?.savedRev).toBe(3)
  })

  it('treats an unreadable scratch payload as nothing saved', () => {
    localStorage.clear()
    localStorage.setItem('planner.scratch.v2', '{"plan":{"garbage":true}}')
    expect(loadScratch()).toBeNull()
  })
})
```

Add `loadScratch` and `createPlan` to the file's imports:

```tsx
import { PlannerShell, loadScratch } from './Planner'
import { createPlan } from '../domain/plan'
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/modules/planner/ui/Planner.test.tsx -t "scratch key migration"`

Expected: FAIL — `loadScratch` is not exported from `./Planner`.

- [ ] **Step 3: Replace the autosave block**

In `app/src/modules/planner/ui/Planner.tsx`, replace the `AUTOSAVE_KEY` constant and the whole `loadAutosave` function (currently lines 61-79) with:

```ts
// Debounced localStorage scratch copy of whatever is on screen, for
// convenience across reloads. It is NOT the plan library (io/library.ts) and
// NOT the source of truth: plan JSON export/import is. A corrupted or
// version-mismatched scratch payload is treated exactly as "nothing saved yet"
// rather than surfaced as an error -- unlike a user-initiated import, this runs
// silently on every mount, and a stale entry from an old build must never block
// the app from loading.
//
// v2 wraps the plan as `{ plan, savedRev }` because savedRev has to survive a
// reload; without it every restored plan would report itself dirty. The v1 key
// held a bare plan, so it is read forward once on first load and nobody with
// in-progress work loses it on upgrade.
const SCRATCH_KEY = 'planner.scratch.v2'
const LEGACY_AUTOSAVE_KEY = 'planner.autosave.v1'
const AUTOSAVE_DEBOUNCE_MS = 500

export interface Scratch {
  plan: DeploymentPlan
  savedRev: number | null
}

export function loadScratch(): Scratch | null {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY)
    if (raw !== null) {
      const outer = JSON.parse(raw) as { plan?: unknown; savedRev?: unknown }
      // Re-stringified so parsePlan stays the one validator in the codebase.
      // JSON.stringify(undefined) yields undefined, which parsePlan's own
      // JSON.parse rejects -- so a payload with no `plan` at all is handled.
      const result = parsePlan(JSON.stringify(outer.plan))
      if (!result.ok) return null
      adoptIdsFrom(result.plan)
      return {
        plan: result.plan,
        savedRev: typeof outer.savedRev === 'number' ? outer.savedRev : null,
      }
    }
    const legacy = localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (legacy === null) return null
    const result = parsePlan(legacy)
    if (!result.ok) return null
    adoptIdsFrom(result.plan)
    // savedRev is null, not 0: a migrated plan has never been written to the
    // library, so it is genuinely unsaved.
    return { plan: result.plan, savedRev: null }
  } catch (err) {
    console.error('[planner] could not read scratch', err)
    return null
  }
}
```

Delete the now-unused `AUTOSAVE_KEY` constant if it is still present.

- [ ] **Step 4: Update the `Planner` component's two effects**

In the default-exported `Planner` component, replace the mount effect and the autosave effect with:

```tsx
export default function Planner() {
  const plan = usePlanStore((s) => s.plan)
  const savedRev = usePlanStore((s) => s.savedRev)

  useEffect(() => {
    const loaded = loadScratch()
    if (loaded) usePlanStore.getState().loadPlan(loaded.plan, loaded.savedRev)
    // Mount-only, to restore the last scratch copy before the user starts
    // editing. Re-running on every `plan` change would fight the write effect
    // below (load, then immediately overwrite the fresh load with itself).
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SCRATCH_KEY, JSON.stringify({ plan, savedRev }))
      } catch (err) {
        console.error('[planner] could not write scratch', err)
      }
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plan, savedRev])

  return (
    <div className="planner-root">
      <MapView
        initialCenter={PLANNER_CENTER}
        initialZoom={PLANNER_ZOOM}
        styleSpec={buildPlannerStyle()}
        manageBasemap={false}
      >
        <PlannerShell />
      </MapView>
    </div>
  )
}
```

Add `DeploymentPlan` to the type import from `../domain/types` if it is not already there (it is imported as `type { Aoi, DeploymentPlan }` already — verify).

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/modules/planner/ui/Planner.test.tsx`

Expected: PASS, including the three new migration tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/planner/ui/Planner.tsx src/modules/planner/ui/Planner.test.tsx
git commit -m "feat(planner): scratch key v2 carries savedRev, migrating v1 forward

Without savedRev in the payload every restored plan would report itself
dirty on reload. The old bare-plan key is read forward once, so nobody
with in-progress work loses it on upgrade."
```

---

### Task 8: Wire `PlansMenu` into the topbar

**Files:**
- Modify: `app/src/modules/planner/ui/PlannerTopbar.tsx`
- Modify: `app/src/modules/planner/ui/PlannerTopbar.test.tsx:54-55`
- Modify: `app/src/modules/planner/ui/Planner.tsx` (`PlannerShell`)

- [ ] **Step 1: Update the topbar's failing test first**

In `app/src/modules/planner/ui/PlannerTopbar.test.tsx`, remove `'IMPORT PLAN'` and `'EXPORT PLAN'` from the expected button-label list at lines 54-55, and add `'PLANS ▾'`. Then add:

```tsx
  it('no longer carries standalone plan import/export buttons', () => {
    renderTopbar()
    expect(screen.queryByRole('button', { name: 'IMPORT PLAN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EXPORT PLAN' })).toBeNull()
    expect(screen.getByRole('button', { name: /PLANS/ })).toBeInTheDocument()
  })
```

Use whatever the file's existing render helper is called; if there is none, inline the same `render(<PlannerTopbar ... />)` call the other tests use, adding a `library={stubLibrary()}` prop once Step 2 introduces it.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/modules/planner/ui/PlannerTopbar.test.tsx`

Expected: FAIL — `PLANS` button not found.

- [ ] **Step 3: Change the topbar**

In `app/src/modules/planner/ui/PlannerTopbar.tsx`:

1. Add to the imports:

```tsx
import PlansMenu from './PlansMenu'
import type { PlanLibrary } from './usePlanLibrary'
```

2. Add to `PlannerTopbarProps`:

```tsx
  library: PlanLibrary
```

3. Widen the dropdown state and add a ref:

```tsx
  const [openMenu, setOpenMenu] = useState<'draw' | 'layers' | 'plans' | null>(null)
  const plansRef = useRef<HTMLDivElement | null>(null)
```

4. Add `plansRef` to the outside-click exemption list, so an inline rename input inside the menu cannot dismiss the menu it lives in:

```tsx
      if (drawRef.current?.contains(target)) return
      if (layersRef.current?.contains(target)) return
      if (plansRef.current?.contains(target)) return
```

5. Delete the `IMPORT PLAN` button, the `EXPORT PLAN` button, the `planInputRef` declaration, the `handlePlanFile` function and the hidden `.json` input — all of it now lives in `PlansMenu`. Keep `onImportPlanFile` / `onExportPlan` in the props: they are forwarded to `PlansMenu`.

6. In their place, immediately before the `← MODULES` link:

```tsx
      <div className="pl-dropdown" ref={plansRef}>
        <PlansMenu
          open={openMenu === 'plans'}
          onToggle={() => setOpenMenu((v) => (v === 'plans' ? null : 'plans'))}
          onClose={() => setOpenMenu(null)}
          library={library}
          onImportPlanFile={onImportPlanFile}
          onExportPlan={onExportPlan}
        />
      </div>
```

7. Add `library` to the destructured props in the function signature.

- [ ] **Step 4: Wire the hook in `PlannerShell`**

In `app/src/modules/planner/ui/Planner.tsx`, inside `PlannerShell`:

1. Import the hook:

```tsx
import { usePlanLibrary } from './usePlanLibrary'
```

2. After the existing `useState` declarations, add:

```tsx
  // useCallback so the hook's own useCallback chain does not re-create every
  // handler on each render of this component.
  const notify = useCallback((message: ImportMessage) => setImportMessage(message), [])
  const library = usePlanLibrary(notify)
```

Add `useCallback` to the `react` import.

3. Pass it to the topbar:

```tsx
      <PlannerTopbar
        library={library}
        drawMode={drawMode}
        ...
```

- [ ] **Step 5: Run the whole planner suite**

Run: `npx vitest run src/modules/planner`

Expected: PASS, every planner test.

- [ ] **Step 6: Commit**

```bash
git add src/modules/planner/ui/PlannerTopbar.tsx src/modules/planner/ui/PlannerTopbar.test.tsx src/modules/planner/ui/Planner.tsx
git commit -m "feat(planner): PLANS menu replaces the two plan-io topbar buttons

Net one topbar button instead of three, on a row that already starts
dropping items at 1120px."
```

---

### Task 9: Full verification

**Files:** none — this task only runs and checks.

- [ ] **Step 1: Run the gate**

Run: `npm run verify`

Expected: PASS — lint clean, no type errors, every test green, build succeeds.

- [ ] **Step 2: Drive it in a real browser**

Unit tests cannot see contrast, layout or the dropdown's real height. Start the dev server:

Run: `npm run dev -- --port 5199`

Then open `http://localhost:5199/planner` and confirm, in order:

1. `PLANS ▾` opens; the menu reads `NO SAVED PLANS`.
2. `SAVE PLAN` writes an entry; the item flips to `SAVED` and disables.
3. Draw an AOI. `SAVE PLAN` re-enables (the plan is dirty again).
4. `SAVE AS NEW` produces a second row named `UNTITLED PLAN (2)`.
5. Click the first row → `UNSAVED CHANGES` confirm appears inline, not as a browser dialog.
6. `DISCARD` loads that plan and closes the menu.
7. `✎` renames in place; Enter commits and the left panel's `NAME` field follows.
8. `⧉` duplicates; `×` asks before deleting.
9. `EXPORT LIBRARY` downloads `plan-library.json`; clear the library with `×`, then `IMPORT LIBRARY…` restores it.
10. Switch the basemap to `SAT` and confirm the menu text is still legible over bright imagery.
11. Narrow the window to 1120px and confirm the topbar still fits.

- [ ] **Step 3: Stop the dev server and commit any fixes**

```bash
git add -A
git commit -m "fix(planner): browser-verification fixes for the plan library"
```

Skip this commit if steps 1-2 needed no changes.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §5 prerequisite — `adoptIdsFrom` | Task 1 |
| §5 key scheme, §6 `library.ts` list/read/save/delete | Task 2 |
| §6 export/import library, envelope format | Task 3 |
| §7 `savedRev` in the store | Task 4 |
| §7 scratch v2 + v1 migration | Task 7 |
| §8 `usePlanLibrary` | Task 5 |
| §8 `PlansMenu`, inline confirms, row actions | Task 6 |
| §8 topbar absorbs `IMPORT`/`EXPORT PLAN` | Task 8 |
| §9 error handling (quota, unavailable, skipped, malformed) | Tasks 2, 3, 5, 6 |
| §10 testing | Tasks 2, 3, 5, 6, 7, 8 |

No spec requirement is unimplemented.

**Type consistency check:** `PlanLibrary` gains `currentPlanId` in Task 6 and is consumed in Tasks 6 and 8. `LibraryListing.entries`/`.skipped`, `SaveResult`, `ImportResult` and `Scratch` are defined once and used with the same names throughout. `savePlan` exists both on `PlanLibrary` (no arguments) and in `io/library.ts` (takes storage and plan); the hook imports the latter aliased as `savePlanToStorage`, so the two never collide. `deletePlan` is aliased the same way, as `deletePlanFromStorage`.

**Placeholder scan:** clean. Every step that changes code shows the code. No "add error handling", no "similar to Task N", no types referenced before they are defined — `PlanLibrary` is fully declared in Task 5 before Tasks 6 and 8 consume it, and `Scratch` in Task 7 before its test uses it.

**Ordering check:** Task 7 (scratch v2) depends on Task 4 (`savedRev` in the store) and is placed after it. Task 8 depends on Tasks 5 and 6 and is placed after both. Task 1 is first because Task 5's final test asserts the id-collision fix it makes.
