# Planner Plan Library — Design

Date: 2026-07-26
Status: approved (design gate exercised in conversation; both sections approved)
Base: `master` @ `b41dc63`

Note: the planner/console UI-parity work (side panels to `bottom: 0`, the `.pl-tree` gap
fix, tile/row tone un-inversion, and the planner panel-collapse toggles) is in the working
tree uncommitted at the time of writing. This spec assumes it lands first; nothing here
depends on it beyond both features touching `PlannerTopbar.tsx` and `planner.css`.

## 1. Purpose

The planner can persist exactly one plan: the `planner.autosave.v1` localStorage key,
debounced 500ms, holding whatever is currently on screen. Everything else is file-based —
`EXPORT PLAN` writes a JSON file, `IMPORT PLAN` reads one back.

That means there is no way to keep several deployment plans and pick between them. A user
working on an Abu Dhabi corridor and a Dubai metro plan has to export one to a file, then
find and import it again to switch back. This spec adds a **plan library**: named plans
saved in the browser, listed in a `PLANS ▾` topbar dropdown, one click to open.

## 2. Scope

In scope:

1. A storage layer over `localStorage` holding many plans, keyed by plan id.
2. A `PLANS ▾` topbar dropdown: save, the list of saved plans, and per-row rename /
   duplicate / delete.
3. Dirty tracking, so opening another plan with unsaved edits asks first.
4. Whole-library export/import as a single JSON file, so a library can be moved to another
   machine or restored after a cache clear.
5. Absorbing the existing `IMPORT PLAN` / `EXPORT PLAN` topbar buttons into the new menu.

Out of scope:

- **Bundled/seed plans.** Considered and rejected in brainstorming: the library holds only
  what the user saves. A fresh browser shows an empty library.
- **Any backend.** This is a static SPA on GitHub Pages; `localStorage` is the only store.
- **Search/filter in the menu.** The list is sorted most-recently-updated first, which is
  sufficient at the scale a single user's library reaches. Revisit if it stops being true.
- **A modal management surface.** Everything lives in the dropdown (approach A).

## 3. Decisions taken in brainstorming

Recorded so the reasoning is not re-litigated during implementation:

| Question | Decision | Why |
| --- | --- | --- |
| Bundled demo plans? | No — user-saved only | Simpler; the user judged an empty-on-fresh-browser library acceptable |
| Where does it live? | `PLANS ▾` topbar dropdown | Mirrors the console's `MISSIONS ▾`; also lets three plan-I/O topbar buttons collapse into one |
| Save model | Explicit `SAVE` + keep the scratch autosave | Familiar document model; the scratch key means nothing is silently lost mid-demo |
| Cross-machine portability | Yes — `EXPORT`/`IMPORT LIBRARY` | Demo tool that runs on client laptops; a cache clear must not be terminal |
| Row actions | Rename, duplicate, delete, overwrite warning | All four requested |
| Structure | Approach A: everything in the dropdown | Only option where the dropdown remains the whole feature; no new UI patterns |

## 4. Format: reuse `planIo.ts`

A library entry **is** a `DeploymentPlan`, serialized by the existing `serializePlan` and
validated by the existing `parsePlan`. There is no second format.

Consequences, all of them wanted:

- Every guarantee `planIo.ts` already makes applies to library reads for free: the
  `schemaVersion` gate, the coverage-params bounds, per-element AOI and dock shape checks,
  and the `aoi.valid` re-derivation that Minor 4 added precisely because it is the one
  function every foreign-plan path already calls.
- A file written by `EXPORT PLAN` and one extracted from the library are the same bytes,
  so `IMPORT PLAN` loads either.
- Nothing new has to be reasoned about for a hand-edited or older-build plan.

## 5. Key scheme

One `localStorage` key per plan:

```
planner.library.v1.<planId>   →  serializePlan(plan)
```

Listing is a prefix scan over `Object.keys(localStorage)`. **There is deliberately no
index key.** An index listing plan ids alongside the entries themselves is two sources of
truth that drift the moment a write half-fails, and the prefix scan makes the entries
their own index.

Per-plan keys rather than one array under a single key, because:

- A plan carrying imported KML can be hundreds of KB. A save must rewrite only that plan.
- A `QuotaExceededError` is then scoped to the plan being saved; the rest of the library is
  untouched and still readable.
- One corrupt or truncated entry cannot take the whole library down. The list skips it.

## 6. New module: `planner/io/library.ts`

Pure. No React, no direct `window` access — it takes a `Storage` so tests run against a
fake and the private-window case is exercisable.

```ts
const LIBRARY_PREFIX = 'planner.library.v1.'

export interface LibraryListing {
  entries: DeploymentPlan[]   // sorted updatedAt descending
  skipped: number             // entries present but unreadable
}

export function listPlans(storage: Storage): LibraryListing
export function readPlan(storage: Storage, id: string): ParseResult
export function savePlan(storage: Storage, plan: DeploymentPlan): SaveResult
export function deletePlan(storage: Storage, id: string): void
export function exportLibrary(storage: Storage): string
export function importLibrary(storage: Storage, json: string): ImportResult

type SaveResult = { ok: true } | { ok: false; message: string }
type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; message: string }
```

`savePlan` wraps `setItem` in try/catch and returns the failure rather than throwing —
`QuotaExceededError` is a normal outcome here, not an exceptional one.

`listPlans` runs each entry through `parsePlan` and drops the failures, **counting** them.
It never returns a silently shortened list; see §9.

Duplicate is not a storage primitive — it is `readPlan` + new id + `uniqueName` +
`savePlan`, composed in the hook (§8), so `library.ts` stays a storage layer.

### Library file format

```json
{
  "libraryVersion": 1,
  "exportedAt": "2026-07-26T00:00:00.000Z",
  "plans": [ /* DeploymentPlan objects, each with its own schemaVersion */ ]
}
```

`libraryVersion` is the **envelope's** version and is deliberately a separate constant from
`PLAN_SCHEMA_VERSION`: the shape of the wrapper and the shape of a plan can evolve
independently, and conflating them would force a library-format bump every time a plan
field changes. It is gated the same way — a library file from a newer build is refused with
a message naming the problem, not partially read. Each contained plan still carries and is
validated against its own `schemaVersion` by `parsePlan`.

`importLibrary` merges **by plan id** — an incoming plan whose id already exists overwrites
it, a new id is added. Each plan goes through `parsePlan` individually; bad ones are
skipped and counted while the good ones land, because a library file is a bag of
independent plans and refusing all fifty because one is malformed helps nobody. This is a
deliberate divergence from `parsePlan`'s all-or-nothing stance on a *single* plan, where
the elements are parts of one object rather than independent items.

## 7. Dirty tracking

`DeploymentPlan.rev` already increments on every mutation — `domain/plan.ts` guarantees it
and `isLayoutStatusCurrent` already leans on the same property. So dirty needs no
structural diffing:

```
dirty  =  savedRev === null || plan.rev !== savedRev
```

`savedRev: number | null` is added to `planStore`, **not** to `DeploymentPlan` — it is
session state about a plan, not content of one, and must never be serialized into an
exported file.

It is set on: `SAVE PLAN` (to `plan.rev`), `SAVE AS NEW` (to the new plan's rev), and
opening a plan from the library (to the loaded plan's rev). It is `null` for a plan that
has never been saved.

### Scratch-key migration

`savedRev` must survive a reload or every restored plan looks dirty. The scratch key
therefore changes shape:

```
planner.scratch.v2  →  { "plan": DeploymentPlan, "savedRev": number | null }
```

On load: read `planner.scratch.v2`. If absent, read the old `planner.autosave.v1`, and if
it parses, adopt it as `{ plan, savedRev: null }` and write it forward to v2. So a user who
pulls this build mid-plan does not lose in-progress work.

A v2 payload that fails to parse is treated exactly as v1 already treats one — as "nothing
saved yet", falling back to a blank plan. A stale scratch key from an old build must never
block the app from loading.

## 8. UI

### `ui/PlansMenu.tsx` (new)

Reuses `.pl-menu` / `.pl-menu-item`. The list section gets `max-height: 65vh;
overflow-y: auto`, copied from the console's `.docks-menu` — the same problem was already
solved there.

```
PLANS ▾
┌───────────────────────────────────┐
│ SAVE PLAN            (SAVED)      │  ← reads SAVED + disabled when clean
│ SAVE AS NEW                       │
│───────────────────────────────────│
│ SAVED PLANS · 3                   │
│ ┌ scrolls, max-height 65vh ─────┐ │
│ │ ABU DHABI CORRIDOR    ✎ ⧉ ×   │ │
│ │   ADNOC · 4 AOI · 12 DOCKS    │ │
│ │   UPDATED 2 MIN AGO           │ │
│ │ DUBAI METRO           ✎ ⧉ ×   │ │
│ └───────────────────────────────┘ │
│───────────────────────────────────│
│ IMPORT PLAN…      EXPORT PLAN     │
│ IMPORT LIBRARY…   EXPORT LIBRARY  │
└───────────────────────────────────┘
```

The dropdown is registered in `PlannerTopbar`'s existing single-`openMenu` state (which
already guarantees only one dropdown is open at a time) with a `plansRef` added to the
outside-click handler's exemption list — that also means an inline rename input inside the
menu does not dismiss the menu it lives in.

### Inline confirmation, never `window.confirm`

A native modal blocks the event loop and is the wrong thing on a projector in front of a
client. Every destructive or lossy action swaps the affected row's contents in place:

| Action | Row becomes |
| --- | --- |
| Open a plan while dirty | `UNSAVED CHANGES · [DISCARD] [CANCEL]` |
| `SAVE PLAN` over an existing entry | `OVERWRITE "<NAME>"? · [OVERWRITE] [CANCEL]` |
| Delete | `DELETE? · [YES] [CANCEL]` |

Opening a plan that is **not** dirty loads immediately and closes the menu — no prompt for
a no-op.

### Actions

- **`SAVE PLAN`** writes to `plan.id`, then `savedRev = plan.rev`. When
  `savedRev === plan.rev` there is nothing to save, so the item reads `SAVED` and is
  disabled; that doubles as the dirty indicator, so no separate dot or asterisk is needed.
- **`SAVE AS NEW`** mints a fresh id via `nextId('plan')` and runs the name through
  `uniqueName(name, taken)`, so saving `UNTITLED PLAN` three times yields three
  distinguishable rows rather than three identical ones. **The working plan then becomes
  the new plan** — same id and name as the entry just written, with `savedRev` tracking it.
  The alternative (write a copy, keep editing the original) would leave `savedRev` pointing
  at an entry the user is no longer editing, which is incoherent the moment they hit
  `SAVE PLAN` again.
- **Rename (`✎`)** swaps the row label into a `.pl-input`; Enter or blur commits, Escape
  cancels. If the renamed plan is the one currently open, the working plan's name updates
  too, so the left panel's `NAME` field cannot disagree with the library.
- **Duplicate (`⧉`)** stores a copy under a new id named via
  `uniqueName(name + ' COPY', taken)`. Does not change what is open.
- **Open** runs `adoptIdsFrom(plan)` then `setPlan(plan)` — the identical path
  `loadAutosave` and `IMPORT PLAN` already take, so there is no second set of load
  semantics to keep correct.
- **Deleting the plan that is currently open** does not close it or clear the map. The
  working plan stays exactly where it is and `savedRev` becomes `null`, which correctly
  reports it as unsaved — because it now is. Wiping the user's screen as a side effect of
  a library-housekeeping action would be a much worse outcome than an open plan that no
  longer has a backing entry.

### `ui/usePlanLibrary.ts` (new)

Owns the seam between store and storage: the listing and its refresh, `dirty`, the
save/open/rename/duplicate/delete/import/export handlers, and the alert messages they
produce. `PlansMenu` stays presentational; `Planner.tsx` renders the alert as it already
does.

### Files touched

| File | Change |
| --- | --- |
| `io/library.ts` | New. Storage layer. |
| `ui/usePlanLibrary.ts` | New. Store ↔ storage wiring, handlers, messages. |
| `ui/PlansMenu.tsx` | New. The dropdown. |
| `store/planStore.ts` | Gains `savedRev` + its setter. |
| `ui/PlannerTopbar.tsx` | Mounts `PlansMenu`; drops the `IMPORT PLAN` / `EXPORT PLAN` buttons and their hidden inputs. |
| `ui/Planner.tsx` | Scratch autosave becomes v2 `{ plan, savedRev }` with v1 migration; wires `usePlanLibrary`. |
| `ui/planner.css` | `.pl-menu-scroll`, row-action buttons, inline-confirm row state. |

## 9. Error handling

Everything surfaces through the `.pl-alert` banner already built into `Planner.tsx`, which
has error/info levels and a dismiss. No new error surface is introduced.

| Failure | Behaviour |
| --- | --- |
| `localStorage` unavailable (private window, disabled) | `listPlans` returns empty; the menu reads `LIBRARY UNAVAILABLE`; a save attempt shows an error alert. No crash, no thrown exception escaping the hook. |
| `QuotaExceededError` on save | Error alert naming the plan. The library is left exactly as it was. |
| A stored entry fails `parsePlan` | Skipped from the list and **counted**: the header reads `3 PLANS · 1 UNREADABLE`. |
| Library import file malformed | Error alert carrying `parsePlan`'s own message. Nothing is written. |
| Library import file partially bad | Good plans imported; alert reads `N IMPORTED · M SKIPPED`. |

The counting rule is not decoration. `planIo.ts` already refuses to hand back a plan
quietly smaller than the file that was opened, on the grounds that silent shrinkage is a
worse failure than a refusal. The library follows the same principle at its own level: it
may skip an unreadable entry, but it always says how many it skipped.

## 10. Testing

New:

- **`io/library.test.ts`** — against a fake `Storage`: round-trip; prefix isolation
  (unrelated `localStorage` keys are never touched or listed); `updatedAt` sort order;
  skip-corrupt-and-count; the quota path returns `ok: false` rather than throwing; delete;
  library export shape; import merge-by-id, including the partially-bad file.
- **`ui/PlansMenu.test.tsx`** — list renders with derived metadata; row click opens; each
  of the three inline confirms, both branches; rename commit vs. Escape-cancel; `SAVE`
  disabled and reading `SAVED` when clean.
- **`ui/usePlanLibrary.test.ts`** — `dirty` across rev bumps; `savedRev` after save,
  save-as-new, and open.

Updated:

- **`ui/PlannerTopbar.test.tsx`** — asserts the `IMPORT PLAN` / `EXPORT PLAN` labels at
  lines 54-55; they move into the menu.
- **`ui/Planner.test.tsx`** — add the scratch `v1 → v2` migration case.

The gate is `npm run verify` (lint, typecheck, tests, build), per the project's standing
rule.

## 11. Risks

- **Quota.** `localStorage` is ~5MB. A handful of KML-heavy plans could approach it. The
  design fails loudly rather than silently, and `EXPORT LIBRARY` is the escape hatch. If
  this becomes routine, IndexedDB is the escalation — deliberately not built now.
- **Menu height.** With many saved plans the dropdown is tall. Mitigated by the `65vh`
  scroll cap, exactly as the console's `DOCKS ▾` handles the same problem.
- **`localStorage` is per-origin and per-browser.** Understood and accepted; the whole
  point of `EXPORT LIBRARY` is that it is not the only copy.
