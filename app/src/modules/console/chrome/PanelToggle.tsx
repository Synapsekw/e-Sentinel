// Ported (Phase 1D / Task 2) from console.html:78-79 (the `#side-toggle` /
// `#rpanel-toggle` markup) and assets/js/ui/panels.js:2568-2585
// (wirePanelToggles): each button toggles its own `body.<cls>-collapsed`
// class and updates its own aria-expanded/title/aria-label to track the new
// state. Legacy toggled a body class and read it straight back off
// `classList.toggle`'s return value; here the store's `sideCollapsed` /
// `rpanelCollapsed` booleans are the source of truth (ConsoleChrome mirrors
// them onto `document.body` in its own effect so the chrome.css selectors
// this button drives, `body.side-collapsed #side` etc., keep working
// unchanged) and this component just reads + flips the matching flag.
//
// `hidden`/`fadeStyle` are optional pass-throughs from ConsoleChrome's
// useChromeFade result (panels.js:2587-2612's wireScene treats
// #side-toggle/#rpanel-toggle as ordinary chrome elements, alongside
// #topbar/#side/#rpanel/#ticker) — applied directly to this real `<button
// id="side-toggle">` element (not a wrapper) so chrome.css's
// `.panel-toggle[hidden]` selector keeps matching the actual DOM node.

import type { CSSProperties } from 'react'
import { useAppStore } from '@/shared/store'

export interface PanelToggleProps {
  side: 'left' | 'right'
  hidden?: boolean
  fadeStyle?: CSSProperties
}

export default function PanelToggle({ side, hidden = false, fadeStyle }: PanelToggleProps) {
  const collapsed = useAppStore((s) => (side === 'left' ? s.sideCollapsed : s.rpanelCollapsed))
  const toggle = useAppStore((s) =>
    side === 'left' ? s.toggleSideCollapsed : s.toggleRpanelCollapsed,
  )

  const buttonId = side === 'left' ? 'side-toggle' : 'rpanel-toggle'
  // panels.js:2577-2583: verb + label track the state the click just
  // produced (i.e. the *next* aria-expanded value: collapsed -> not
  // collapsed reads "Collapse", already collapsed -> not yet collapsed reads
  // "Expand" — same as legacy's post-toggle `collapsed` read).
  const verb = collapsed ? 'Expand' : 'Collapse'
  const label = `${verb} ${side} panel`

  return (
    <button
      id={buttonId}
      className="panel-toggle chrome-in"
      type="button"
      hidden={hidden}
      style={fadeStyle}
      aria-expanded={!collapsed}
      title={`${verb} panel`}
      aria-label={label}
      onClick={() => toggle()}
    >
      <i />
    </button>
  )
}
