// Topbar chrome: e& brand, then the tool row (import AOI / draw / dock
// placement / suggest layout / plan export-import / basemap LAYERS), mirroring the console
// Topbar's layout (chip/tbtn row, `.sp` spacer, trailing nav) but with its
// own `pl-*` classes (see planner.css's header comment for why). The four
// tool controls that touch the map (draw mode, dock placement) are owned by
// Planner.tsx's PlannerShell -- the component that actually holds the
// useAoiDraw/useDockPlacement hook instances -- and handed down here as
// plain callbacks/state, so this component itself never needs the map.
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AoiDrawMode } from '@/modules/planner/map/useAoiDraw'
import PlannerLayersMenu from './PlannerLayersMenu'

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
}: PlannerTopbarProps) {
  // One `openMenu` rather than one boolean per dropdown: two independent
  // booleans can both be true, which would put two absolutely-positioned
  // pl-menu panels on screen at once. Same reasoning the console applies to
  // `controlMode` and Planner.tsx applies to draw-vs-dock-placement (Minor 6):
  // a single variable makes "only one at a time" unrepresentable-otherwise
  // instead of merely well-behaved.
  const [openMenu, setOpenMenu] = useState<'draw' | 'layers' | null>(null)
  const drawRef = useRef<HTMLDivElement | null>(null)
  const layersRef = useRef<HTMLDivElement | null>(null)
  const aoiInputRef = useRef<HTMLInputElement | null>(null)
  const planInputRef = useRef<HTMLInputElement | null>(null)

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
  function handlePlanFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportPlanFile(file)
  }

  return (
    <header className="pl-topbar">
      <div className="pl-brand">
        <img
          className="pl-logo"
          src={`${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`}
          alt="e&"
        />
        <div>
          <div className="pl-title">DEPLOYMENT PLANNER</div>
          <div className="lbl">AOI · DOCKS · COVERAGE</div>
        </div>
      </div>

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

      <button type="button" className="pl-btn" onClick={onSuggestLayout}>
        SUGGEST LAYOUT
      </button>

      <button type="button" className="pl-btn" onClick={onExportPlan}>
        EXPORT PLAN
      </button>
      {/* Not part of the brief's enumerated topbar button list, but "plan
          JSON export/import" (this task's Step 4) needs an import path to
          be more than half a feature -- EXPORT PLAN with nothing to load it
          back into would be a dead end. Kept visually secondary (ghost
          style, smaller) so it doesn't compete with the primary tool row. */}
      <button
        type="button"
        className="pl-btn pl-btn-ghost"
        onClick={() => planInputRef.current?.click()}
        title="Load a plan JSON file exported from this or another session"
      >
        IMPORT PLAN
      </button>
      <input
        ref={planInputRef}
        type="file"
        accept=".json"
        className="pl-hidden-input"
        onChange={handlePlanFile}
      />

      <div className="pl-dropdown" ref={layersRef}>
        <PlannerLayersMenu
          open={openMenu === 'layers'}
          onToggle={() => setOpenMenu((v) => (v === 'layers' ? null : 'layers'))}
          onClose={() => setOpenMenu(null)}
        />
      </div>

      <div className="pl-spacer" />

      <Link className="lbl pl-back" to="/">
        ← MODULES
      </Link>
    </header>
  )
}
