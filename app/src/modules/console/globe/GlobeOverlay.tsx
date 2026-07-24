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

import type { MutableRefObject } from 'react'
import { useAppStore } from '@/shared/store'
import './globe.css'

export interface GlobeOverlayProps {
  /** Ref to the beacon "click to enter theater" tag; positioned each frame by useGlobe. */
  tagRef: MutableRefObject<HTMLButtonElement | null>
  /** Ref to the ALT ... KM readout; text updated each frame by useGlobe while diving. */
  altRef: MutableRefObject<HTMLDivElement | null>
  /** Invoked when the operator clicks the beacon tag or the ENTER THEATER button. */
  onEnter: () => void
}

export default function GlobeOverlay({ tagRef, altRef, onEnter }: GlobeOverlayProps) {
  const scene = useAppStore((s) => s.scene)

  return (
    <div id="globe-ui" hidden={scene !== 'globe'}>
      <div className="g-brand">
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
      <button id="globe-enter-btn" type="button" onClick={onEnter}>
        ENTER THEATER
      </button>
    </div>
  )
}
