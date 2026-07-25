// Ported (Phase 1C / Task 3) from assets/js/main.js:35-49 (EC2.refreshCounts).
// Legacy computed the counts and immediately pushed them into EC2.ui.setStats
// (mutating the DOM chips/tiles as a side effect of counting). Split here
// into a pure function returning a GridStats value — useLiveLayers.ts is the
// caller that then hands the result to the store's setStats action, keeping
// this module trivially unit-testable without a map, store, or DOM.
//
// legacy's `flying`/`airborne` and `alert`/`alerts` duplicate keys collapse
// to the store's GridStats shape (ready/flying/charge/alert) — see
// shared/store.ts's GridStats, which already dropped the redundant aliases.

import type { Engine } from '@/modules/console/domain'
import type { GridStats } from '@/shared/store'

export function computeCounts(engine: Engine): GridStats {
  let ready = 0
  let charging = 0
  let alertDocks = 0
  let airborne = 0

  for (const dock of engine.docks.values()) {
    if (dock.state === 'ready') ready++
    else if (dock.state === 'charging') charging++
    else if (dock.state === 'fault' || dock.state === 'offline') alertDocks++
  }
  for (const drone of engine.drones.values()) {
    if (drone.state !== 'docked') airborne++
  }

  return { ready, flying: airborne, charge: charging, alert: alertDocks }
}
