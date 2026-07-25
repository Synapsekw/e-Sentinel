// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:87-91 (hashStr),
// :96-113 (batteryFor/stateFor), :2049-2090 (dockMatchesSearch,
// dockStateRank, EMIRATE_ORDER re-derivation, dockListRows) and
// :2350-2358 (renderDockList's inline emirate-header grouping, split out
// here as groupRows so DockList.tsx can render a flat, keyed item list).
//
// Pure (engine is always passed in, never read off a global) so this is
// unit-testable without a React tree or a live map/engine singleton.

import { DATA_DOCKS } from '@/modules/console/domain'
import type { DockSeed, DockState, Engine } from '@/modules/console/domain'
import type { DockSort, FilterKey } from '@/shared/store'
import { EMIRATE_NAMES, EMIRATE_ORDER } from './emirates'
import { ALERT_STATES, FLYING_STATES } from './format'

// Deterministic per-dock hash so the same dock always shows the same
// battery reading across re-renders when no engine is live yet.
// panels.js:87-91.
export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// panels.js:96-102. Live `Math.round(dock.battery)` once the engine has the
// dock, else a deterministic 85..99 hash-based placeholder.
export function batteryFor(engine: Engine | null, id: string): number {
  if (engine) {
    const dock = engine.docks.get(id)
    if (dock) return Math.round(dock.battery)
  }
  return 85 + (hashStr(id) % 15)
}

// panels.js:107-113. Live sim state once the engine has the dock, else
// 'ready' so filters/UI have a sane default before dive-in.
export function stateFor(engine: Engine | null, dock: DockSeed): DockState {
  if (engine) {
    const live = engine.docks.get(dock.id)
    if (live) return live.state
  }
  return 'ready'
}

// panels.js:2049-2053.
export function dockMatchesSearch(d: DockSeed, search: string): boolean {
  if (!search) return true
  const hay = (
    d.id +
    ' ' +
    d.name +
    ' ' +
    d.emirate +
    ' ' +
    (EMIRATE_NAMES[d.emirate] || '')
  ).toLowerCase()
  return hay.indexOf(search) !== -1
}

// STATE sort order per spec: fault (incl. offline) first, then charging,
// ready, and away (any flying state) last. panels.js:2057-2062.
export function dockStateRank(state: DockState): number {
  if (ALERT_STATES.includes(state)) return 0
  if (state === 'charging') return 1
  if (state === 'ready') return 2
  return 3 // launching / drone-away / landing -- "away"
}

// The current filter+search+sort applied to DATA_DOCKS, returned in final
// render order (ID sort additionally clusters by emirate so the group
// headers come out contiguous). panels.js:2069-2090.
export function dockListRows(
  engine: Engine | null,
  filter: FilterKey,
  search: string,
  sort: DockSort,
): DockSeed[] {
  const rows = DATA_DOCKS.filter((d) => {
    if (!dockMatchesSearch(d, search)) return false
    if (filter === 'ALL') return true
    if (filter === 'FLYING') return FLYING_STATES.includes(stateFor(engine, d))
    if (filter === 'ALERTS') return ALERT_STATES.includes(stateFor(engine, d))
    return d.emirate === filter
  })
  if (sort === 'BATT') {
    // Lowest charge first -- the rows an operator needs to see are the ones
    // closest to unavailable.
    rows.sort(
      (a, b) => batteryFor(engine, a.id) - batteryFor(engine, b.id) || a.id.localeCompare(b.id),
    )
  } else if (sort === 'STATE') {
    rows.sort(
      (a, b) =>
        dockStateRank(stateFor(engine, a)) - dockStateRank(stateFor(engine, b)) ||
        a.id.localeCompare(b.id),
    )
  } else {
    rows.sort((a, b) => {
      const ea = EMIRATE_ORDER.indexOf(a.emirate)
      const eb = EMIRATE_ORDER.indexOf(b.emirate)
      return ea - eb || a.id.localeCompare(b.id)
    })
  }
  return rows
}

export type DockListItem = { kind: 'group'; emirate: string } | { kind: 'row'; dock: DockSeed }

// Split out of renderDockList's inline loop (panels.js:2350-2358): emits an
// emirate header before the first row of each emirate, but only under ID
// sort -- BATT/STATE render flat since their order cuts across emirates.
export function groupRows(rows: DockSeed[], sort: DockSort): DockListItem[] {
  const items: DockListItem[] = []
  let lastEmirate: string | null = null
  for (const d of rows) {
    if (sort === 'ID' && d.emirate !== lastEmirate) {
      lastEmirate = d.emirate
      items.push({ kind: 'group', emirate: d.emirate })
    }
    items.push({ kind: 'row', dock: d })
  }
  return items
}
