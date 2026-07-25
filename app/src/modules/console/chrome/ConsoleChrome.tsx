// Ported (Phase 1D / Task 2) from console.html:24-80 (the topbar/side/rpanel/
// panel-toggle/ticker DOM skeleton) and assets/js/ui/panels.js:2572-2585
// (wirePanelToggles) + :2587-2631 (wireScene). This component owns only the
// shell's element ids/nesting and the scene-fade/collapse wiring; it renders
// no panel content of its own — Tasks 3-7 build the topbar/sidebar/right-panel
// contents and pass them in as `topbar`/`sidebar`/`rightPanel`/`ticker`,
// exactly mirroring how legacy's `#topbar`/`#side`/`#rpanel-body` were empty
// shells in console.html, filled in later by panels.js.
//
// wireScene's `chromeEls` list (#topbar, #side, #rpanel, #ticker,
// #side-toggle, #rpanel-toggle) all shared one `chrome-in` class and the same
// hidden/opacity driven by a single setVisible(show) call keyed off
// EC2.state.scene; useChromeFade(scene) below is that same show/hide state
// machine, and every element below applies its `hidden`/`opacity` output.
//
// wirePanelToggles kept collapse state as `body.side-collapsed` /
// `body.rpanel-collapsed` classes (so chrome.css's `body.side-collapsed
// #side{transform:...}` selectors work); this component mirrors the store's
// `sideCollapsed`/`rpanelCollapsed` flags onto `document.body` in an effect
// (with cleanup) so those selectors keep working unchanged even though the
// store, not the DOM class itself, is now the source of truth.

import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useAppStore } from '@/shared/store'
import { useChromeFade } from './useChromeFade'
import PanelToggle from './PanelToggle'
import './chrome.css'

export interface ConsoleChromeProps {
  topbar: ReactNode
  sidebar: ReactNode
  rightPanel: ReactNode
  ticker: ReactNode
}

export default function ConsoleChrome({ topbar, sidebar, rightPanel, ticker }: ConsoleChromeProps) {
  const scene = useAppStore((s) => s.scene)
  const sideCollapsed = useAppStore((s) => s.sideCollapsed)
  const rpanelCollapsed = useAppStore((s) => s.rpanelCollapsed)
  const { hidden, opacity } = useChromeFade(scene)

  // panels.js:2568-2585 (wirePanelToggles): body classes, not inline styles,
  // are what chrome.css's collapse-transform/backing selectors key off.
  useEffect(() => {
    document.body.classList.toggle('side-collapsed', sideCollapsed)
    return () => document.body.classList.remove('side-collapsed')
  }, [sideCollapsed])
  useEffect(() => {
    document.body.classList.toggle('rpanel-collapsed', rpanelCollapsed)
    return () => document.body.classList.remove('rpanel-collapsed')
  }, [rpanelCollapsed])

  const fadeStyle: CSSProperties = { opacity }

  return (
    <>
      <header id="topbar" className="chrome-in" hidden={hidden} style={fadeStyle}>
        {topbar}
      </header>
      <aside id="side" className="chrome-in" hidden={hidden} style={fadeStyle}>
        {sidebar}
      </aside>
      <aside id="rpanel" className="chrome-in" hidden={hidden} style={fadeStyle}>
        <div id="rpanel-body">{rightPanel}</div>
      </aside>
      <PanelToggle side="left" hidden={hidden} fadeStyle={fadeStyle} />
      <PanelToggle side="right" hidden={hidden} fadeStyle={fadeStyle} />
      {/* The real footer#ticker element is Ticker.tsx's own DOM node (out of
          this task's scope to edit); this wrapper is the only way to apply
          the shared chrome-in/hidden/opacity fade to "the ticker slot"
          without reaching into that component. It adds no positioning of its
          own — #ticker stays `position:fixed` regardless of its parent. */}
      <div className="chrome-in" hidden={hidden} style={fadeStyle}>
        {ticker}
      </div>
    </>
  )
}
