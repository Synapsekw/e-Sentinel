// Ported (Phase 1C / Task 4; wrapper moved to Sidebar.tsx in Phase 1D / Task
// 6) from console.html:49-56 (the `#grid-stats` tiles inside the "National
// grid" side panel) and assets/js/ui/panels.js:2294-2298 (setStats's ready/
// flying/charge/alert branch — the airborne/alerts header-chip branches at
// :2299-2308 belong to the real topbar, Phase 1D's Task 4). Each tile's
// number is driven by useCountUp so it counts up/down the same way
// tweenStat animated `#st-ready` etc.
//
// Renders only the `<div class="stats" id="grid-stats">` tiles now that the
// real `#side` aside exists (Task 2/6): the surrounding `.panel` +
// `<h4 class="lbl">National grid</h4>` wrapper, and the fixed-position
// `#grid-stats-panel`/`.hud-panel` styling that stood in for it before the
// real sidebar landed, both moved to Sidebar.tsx / were deleted from
// hud.css.

import { useAppStore } from '@/shared/store'
import type { GridStats as GridStatsValue } from '@/shared/store'
import { useCountUp } from './useCountUp'
import './hud.css'

interface Tile {
  key: keyof GridStatsValue
  label: string
}

// console.html:52-55's tile order/copy, verbatim.
const TILES: Tile[] = [
  { key: 'ready', label: 'Ready' },
  { key: 'flying', label: 'Flying' },
  { key: 'charge', label: 'Charging' },
  { key: 'alert', label: 'Alerts' },
]

function StatTile({ value, label }: { value: number; label: string }) {
  const display = useCountUp(value)
  return (
    <div className="st">
      <div className="n">{display}</div>
      <div className="c">{label}</div>
    </div>
  )
}

export default function GridStats() {
  const stats = useAppStore((s) => s.stats)

  return (
    <div className="stats" id="grid-stats">
      {TILES.map((t) => (
        <StatTile key={t.key} value={stats[t.key]} label={t.label} />
      ))}
    </div>
  )
}
