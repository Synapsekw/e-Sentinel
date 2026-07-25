// Ported (Phase 1B / Task 4) from console.html's #globe-ui block (the
// brand, hint, beacon tag, and alt readout markup) plus globe.js's
// buildEnterButton (:247-257, the persistent ENTER THEATER button). Only
// the module wiring changed: the tag/alt DOM nodes are no longer looked up
// by id (document.getElementById) — they're exposed as tagRef/altRef so
// useGlobe.ts (called by a sibling/parent inside <MapView>) can position
// and update them imperatively every animation frame, matching legacy's
// per-frame direct DOM writes. The whole overlay's visibility mirrors
// #globe-ui's `hidden` toggling: legacy only ever flips it in lockstep with
// `scene` (hidden exactly when scene==='console'), so this component
// derives its own hidden state from the store instead of needing a
// `visible`/`hidden` prop from the caller.
//
// The `.g-logo` brand image (deferred from Task 4 to Task 5, which vendors
// the asset) is sourced from `import.meta.env.BASE_URL` rather than a
// hardcoded `/assets/...` path so it resolves under both the dev root (`/`)
// and the GitHub Pages base path (`/e-Sentinel/`); the file itself is
// copied verbatim from `assets/img/eand-logo-white.png` into
// `app/public/assets/img/`, not modified.

import type { MutableRefObject } from 'react'
import { useAppStore } from '@/shared/store'
import './globe.css'

export interface GlobeOverlayProps {
  /** Ref to the beacon "click to enter theater" tag; positioned each frame by useGlobe. */
  tagRef: MutableRefObject<HTMLButtonElement | null>
  /** Ref to the ALT ... KM readout; text updated each frame by useGlobe while diving. */
  altRef: MutableRefObject<HTMLDivElement | null>
  /**
   * Ref to the persistent ENTER THEATER button; useGlobe hides it
   * imperatively (and synchronously) at dive start, and restores it once
   * back in the 'globe' scene — matching legacy's enterBtn.hidden toggling
   * (globe.js:263, :323), which the declarative `scene` prop alone can't
   * express since `scene` only flips at flight moveend.
   */
  enterBtnRef: MutableRefObject<HTMLButtonElement | null>
  /** Invoked when the operator clicks the beacon tag or the ENTER THEATER button. */
  onEnter: () => void
}

export default function GlobeOverlay({ tagRef, altRef, enterBtnRef, onEnter }: GlobeOverlayProps) {
  const scene = useAppStore((s) => s.scene)

  return (
    <div id="globe-ui" hidden={scene !== 'globe'}>
      <div className="g-brand">
        <img
          className="g-logo"
          src={`${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`}
          alt="e&"
        />
        <div>
          <b>SENTINEL</b>
          <span className="lbl">GLOBAL COMMAND &amp; CONTROL · ORBITAL VIEW</span>
        </div>
      </div>
      <div className="g-hint lbl">DRAG TO ROTATE · CLICK UAE TO ENTER THEATER</div>
      {/* Click handling for this button is wired imperatively by useGlobe's
          wireClicks (matches legacy's tagEl.addEventListener) rather than a
          React onClick, so it shares one code path with the map's
          click-near-beacon handler. */}
      <button ref={tagRef} id="uae-beacon-tag" className="g-tag" type="button" hidden>
        <b>UNITED ARAB EMIRATES</b>
        <span className="ok">GRID ONLINE · 104 DOCKS</span>
        <span className="lbl">CLICK TO ENTER THEATER</span>
      </button>
      <div ref={altRef} className="g-alt lbl" id="g-alt">
        ALT 12742 KM · ORBITAL
      </div>
      <button ref={enterBtnRef} id="globe-enter-btn" type="button" onClick={onEnter}>
        ENTER THEATER
      </button>
    </div>
  )
}
