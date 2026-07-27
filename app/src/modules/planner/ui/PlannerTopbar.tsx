// Topbar chrome: e& brand and the offline chip, then a spacer, then the action
// row led by basemap LAYERS -- the same position the console's #btn-layers
// occupies after its own `.sp` spacer, so the control is in one place in the
// user's memory across both modules. Then the map tools (draw, dock placement,
// suggest layout) and the plan I/O controls.
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AoiDrawMode } from '@/modules/planner/map/useAoiDraw'
import OfflineChip from '@/modules/console/OfflineChip'
import PlannerLayersMenu from './PlannerLayersMenu'
import PlansMenu from './PlansMenu'
import type { PlanLibrary } from './usePlanLibrary'

export interface PlannerTopbarProps {
  drawMode: AoiDrawMode
  onSetDrawMode: (mode: AoiDrawMode) => void
  onCancelDraw: () => void
  placingDock: boolean
  onToggleDockPlacement: () => void
  onImportAoiFile: (file: File) => void
  onImportPlanFile: (file: File) => void
  onExportPlan: () => void
  onSuggestLayout: () => void
  // True while PlannerShell's yield-then-compute auto-placement is in flight.
  // Only the SUGGEST LAYOUT button reacts to it: the rest of the topbar stays
  // live, since nothing else here is what the user is waiting on.
  suggestBusy: boolean
  library: PlanLibrary
}

const DRAW_LABEL: Record<AoiDrawMode, string> = {
  idle: 'DRAW',
  polygon: 'DRAW · POLYGON',
  rectangle: 'DRAW · RECTANGLE',
  circle: 'DRAW · CIRCLE',
}

export default function PlannerTopbar({
  drawMode,
  onSetDrawMode,
  onCancelDraw,
  placingDock,
  onToggleDockPlacement,
  onImportAoiFile,
  onImportPlanFile,
  onExportPlan,
  onSuggestLayout,
  suggestBusy,
  library,
}: PlannerTopbarProps) {
  // One `openMenu` rather than one boolean per dropdown: two independent
  // booleans can both be true, which would put two absolutely-positioned
  // pl-menu panels on screen at once. Same reasoning the console applies to
  // `controlMode` and Planner.tsx applies to draw-vs-dock-placement (Minor 6):
  // a single variable makes "only one at a time" unrepresentable-otherwise
  // instead of merely well-behaved.
  const [openMenu, setOpenMenu] = useState<'draw' | 'layers' | 'plans' | null>(null)
  const drawRef = useRef<HTMLDivElement | null>(null)
  const layersRef = useRef<HTMLDivElement | null>(null)
  const plansRef = useRef<HTMLDivElement | null>(null)
  const aoiInputRef = useRef<HTMLInputElement | null>(null)

  // Close whichever dropdown is open on an outside click, same convention as
  // a native <select>/menu: without this it only ever closes via picking an
  // item, which reads as broken once a user clicks elsewhere on the map.
  // "Outside" means outside BOTH dropdown containers, so clicking the other
  // dropdown's button still reaches its own onClick (which swaps openMenu)
  // rather than being eaten as a dismiss.
  useEffect(() => {
    if (openMenu === null) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (drawRef.current?.contains(target)) return
      if (layersRef.current?.contains(target)) return
      if (plansRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [openMenu])

  function pickMode(mode: AoiDrawMode) {
    onSetDrawMode(mode)
    setOpenMenu(null)
  }

  function handleAoiFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportAoiFile(file)
  }

  return (
    <header className="pl-topbar">
      {/* Home link, matching the console's `.t-brand`/`.g-brand`: the logo
          goes back to the module landing page from every surface, so the
          presenter never has to hunt for the way out. The explicit
          `← MODULES` link at the end of the row stays -- it is the discoverable
          label; this is the reflex target. */}
      <Link className="pl-brand" to="/" title="BACK TO MODULES">
        <img
          className="pl-logo"
          src={`${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`}
          alt="e&"
        />
        <div>
          <div className="pl-title">DEPLOYMENT PLANNER</div>
          <div className="lbl">AOI · DOCKS · COVERAGE</div>
        </div>
      </Link>

      <OfflineChip className="pl-chip pl-chip-warn" />

      <div className="pl-spacer" />

      <div className="pl-dropdown" ref={layersRef}>
        <PlannerLayersMenu
          open={openMenu === 'layers'}
          onToggle={() => setOpenMenu((v) => (v === 'layers' ? null : 'layers'))}
          onClose={() => setOpenMenu(null)}
        />
      </div>

      <div className="pl-dropdown" ref={drawRef}>
        <button
          type="button"
          className={`pl-btn${drawMode !== 'idle' ? ' active' : ''}`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'draw'}
          onClick={() => setOpenMenu((v) => (v === 'draw' ? null : 'draw'))}
        >
          {DRAW_LABEL[drawMode]} ▾
        </button>
        {openMenu === 'draw' ? (
          <div className="pl-menu" role="menu">
            <button type="button" className="pl-menu-item" onClick={() => pickMode('polygon')}>
              POLYGON
            </button>
            <button type="button" className="pl-menu-item" onClick={() => pickMode('rectangle')}>
              RECTANGLE
            </button>
            <button type="button" className="pl-menu-item" onClick={() => pickMode('circle')}>
              CIRCLE
            </button>
            {drawMode !== 'idle' ? (
              <button
                type="button"
                className="pl-menu-item"
                onClick={() => {
                  onCancelDraw()
                  setOpenMenu(null)
                }}
              >
                STOP DRAWING
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={`pl-btn${placingDock ? ' active' : ''}`}
        onClick={onToggleDockPlacement}
      >
        + DOCK
      </button>

      <button type="button" className="pl-btn" onClick={onSuggestLayout} disabled={suggestBusy}>
        {suggestBusy ? 'PLACING DOCKS' : 'SUGGEST LAYOUT'}
      </button>

      <button type="button" className="pl-btn" onClick={() => aoiInputRef.current?.click()}>
        IMPORT AOI
      </button>
      <input
        ref={aoiInputRef}
        type="file"
        accept=".kml,.kmz"
        className="pl-hidden-input"
        onChange={handleAoiFile}
      />

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

      <Link className="lbl pl-back" to="/">
        ← MODULES
      </Link>
    </header>
  )
}
