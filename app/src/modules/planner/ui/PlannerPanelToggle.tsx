// The planner's counterpart to console/chrome/PanelToggle.tsx: the glass
// handle tab pinned to a side panel's inner edge that collapses it off screen
// and rides along to the screen edge, so the map can be worked without chrome
// over it. The planner had no collapse affordance at all.
//
// It reads and flips the SAME shared/store flags the console's PanelToggle
// does (`sideCollapsed` / `rpanelCollapsed`) rather than introducing a second
// pair: the two modules are separate routes that never mount together, so one
// piece of state cannot be in two places at once, and carrying the preference
// across a /console <-> /planner navigation is the behaviour you want anyway.
// Planner.tsx mirrors those flags onto `document.body` for the
// `body.side-collapsed .pl-side` selectors in planner.css, exactly as
// ConsoleChrome.tsx does for chrome.css's.
//
// Class names, not ids: planner.css keeps every selector `pl-*`-prefixed and
// self-contained (see its header comment), so this deliberately does not reuse
// the console's `#side-toggle` / `#rpanel-toggle` ids or its `.panel-toggle`
// class.

import { useAppStore } from '@/shared/store'

export interface PlannerPanelToggleProps {
  side: 'left' | 'right'
}

export default function PlannerPanelToggle({ side }: PlannerPanelToggleProps) {
  const collapsed = useAppStore((s) => (side === 'left' ? s.sideCollapsed : s.rpanelCollapsed))
  const toggle = useAppStore((s) =>
    side === 'left' ? s.toggleSideCollapsed : s.toggleRpanelCollapsed,
  )

  // Same convention as PanelToggle.tsx: verb + label describe the state the
  // click will produce, i.e. the next aria-expanded value.
  const verb = collapsed ? 'Expand' : 'Collapse'

  return (
    <button
      type="button"
      className={`pl-panel-toggle ${side === 'left' ? 'pl-side-toggle' : 'pl-rpanel-toggle'}`}
      aria-expanded={!collapsed}
      title={`${verb} panel`}
      aria-label={`${verb} ${side} panel`}
      onClick={() => toggle()}
    >
      <i />
    </button>
  )
}
