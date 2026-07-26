// Ported (Phase 1D / Task 4) from console.html:24-43 (the topbar DOM),
// assets/js/ui/panels.js:2294-2309 (setStats's #c-air/#c-alerts chip
// branches), :2497-2529 (wireTopbar), :1967-1971 (updateFilterButtonLabel),
// :1986-1991 (updateLayersButtonLabel), and assets/css/console.css:67-88 +
// :536-553 (topbar styles + responsive drop-out, both already ported into
// chrome/chrome.css by Task 2 — this component only supplies the markup).
//
// Renders the CONTENTS of `<header id="topbar">`, not the header element
// itself — ConsoleChrome.tsx (Task 2) owns the `#topbar` wrapper and the
// scene-fade hidden/opacity it applies; Topbar is passed to it as the
// `topbar` prop, matching console.html's empty `<header id="topbar">` shell
// later filled in by panels.js.
//
// main.js:45-47 sets `flying: airborne` and `alert: alertDocks` when calling
// EC2.ui.setStats — the store's `stats.flying`/`stats.alert` (Phase 1D
// Task 1) ARE legacy's airborne/alerts counts, just carried under the sidebar
// tile's field names since one setStats call fed both the header chips and
// the sidebar grid-stats tiles. #c-air and #c-alerts below tween off those
// same fields via useCountUp, the hook-ified port of tweenStat.
//
// DOCKS/FILTER/LAYERS only toggle the store's `openMenu` field here — the
// dropdown menus themselves (TopMenu/DocksMenu/FilterMenu/LayersMenu) are a
// different task's scope; this component never renders their contents.
//
// PHASE 1E / TASK 1: #btn-newmission / #btn-missions stop being
// unconditionally disabled. Their disabled/title now come from
// control/controlModel.ts's newMissionButtonState/missionsButtonState
// (control.js:56-84), driven by the store's `controlMode`. The buttons'
// actual behavior (opening the wizard / toggling the MISSIONS dropdown)
// is Tasks 3 and 4's scope; until those land, the two buttons take
// optional `onNewMission`/`onToggleMissions` props defaulting to no-ops so
// this component compiles and reviews standing alone. #btn-media opens the
// MEDIA library panel directly (panels.js:2520-2527) — it needs no
// callback, since exiting capture modes goes through the same
// registerCaptureExits registry selectEntity uses.

import { useAppStore } from '@/shared/store'
import type { TopMenuName } from '@/shared/store'
import { DATA_DOCKS } from '@/modules/console/domain'
import { useCountUp } from '@/modules/console/hud/useCountUp'
import { clearSelection, openMediaLibrary } from '@/modules/console/selection'
import { newMissionButtonState, missionsButtonState } from '@/modules/console/control/controlModel'
import { layerButtonLabel } from '@/modules/console/map/basemap'
import Clock from './Clock'
import OfflineChip from '../OfflineChip'

export interface TopbarProps {
  onExitToOrbit: () => void
  onNewMission?: () => void
  onToggleMissions?: () => void
}

export default function Topbar({
  onExitToOrbit,
  onNewMission = () => {},
  onToggleMissions = () => {},
}: TopbarProps) {
  const stats = useAppStore((s) => s.stats)
  const dockFilter = useAppStore((s) => s.dockFilter)
  const layer = useAppStore((s) => s.layer)
  const openMenu = useAppStore((s) => s.openMenu)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)
  const controlMode = useAppStore((s) => s.controlMode)

  const airborne = useCountUp(stats.flying)
  const alerts = useCountUp(stats.alert)
  const newMissionState = newMissionButtonState(controlMode)
  const missionsState = missionsButtonState(controlMode)

  // panels.js:1863-1936 (topMenus): a single `openMenu` field already
  // guarantees only one dropdown is open at a time; each trigger just
  // toggles its own name off/on.
  function toggleMenu(name: TopMenuName): void {
    setOpenMenu(openMenu === name ? null : name)
  }

  const filterLabel = dockFilter === 'ALL' ? 'FILTER' : 'FILTER · ' + dockFilter
  const layerLabel = layerButtonLabel(layer)

  return (
    <>
      <div className="t-brand">
        <img
          className="t-logo"
          src={`${import.meta.env.BASE_URL}assets/img/eand-logo-white.png`}
          alt="e&"
        />
        <div>
          <div className="ttl">SENTINEL</div>
          <div className="lbl">GLOBAL COMMAND &amp; CONTROL</div>
        </div>
      </div>
      <div className="chip ok-chip">
        <span className="dot" />
        GRID ONLINE
      </div>
      <button
        className="chip chip-btn"
        id="btn-docks"
        type="button"
        aria-haspopup="true"
        aria-expanded={openMenu === 'docks'}
        onClick={() => toggleMenu('docks')}
      >
        DOCKS <b>{DATA_DOCKS.length}</b> <span className="caret">▾</span>
      </button>
      <div className="chip" id="c-air">
        AIRBORNE <b>{airborne}</b>
      </div>
      {/* panels.js:2307: `chip.hidden = !o.alerts` toggles off the RAW target
          count, not the tweened display value — only the <b> number below
          animates via useCountUp. */}
      <div className="chip warn" id="c-alerts" hidden={stats.alert === 0}>
        ALERTS <b>{alerts}</b>
      </div>
      <OfflineChip />
      <div className="sp" />
      <button
        className="tbtn"
        id="btn-layers"
        type="button"
        aria-haspopup="true"
        aria-expanded={openMenu === 'layers'}
        onClick={() => toggleMenu('layers')}
      >
        {layerLabel} ▾
      </button>
      <button
        className="tbtn"
        id="btn-filter"
        type="button"
        aria-haspopup="true"
        aria-expanded={openMenu === 'filter'}
        onClick={() => toggleMenu('filter')}
      >
        {filterLabel} ▾
      </button>
      <button
        className="tbtn"
        id="btn-ops"
        type="button"
        title="OPS DIGEST"
        onClick={() => clearSelection()}
      >
        OPS
      </button>
      {/* Phase 1E / Task 4 wires onToggleMissions to the MISSIONS dropdown
          (control.js:774-847's buildMissionsMenu); disabled/title already
          track control.js:73-83 via missionsButtonState. */}
      <button
        className="tbtn"
        id="btn-missions"
        type="button"
        title={missionsState.title}
        aria-haspopup="true"
        aria-expanded={openMenu === 'missions'}
        disabled={missionsState.disabled}
        onClick={onToggleMissions}
      >
        MISSIONS ▾
      </button>
      {/* Phase 1E / Task 3 wires onNewMission to control.enterWizard
          (control.js:502-521); disabled/title already track control.js:56-69
          via newMissionButtonState. */}
      <button
        className="tbtn"
        id="btn-newmission"
        type="button"
        title={newMissionState.title}
        disabled={newMissionState.disabled}
        onClick={onNewMission}
      >
        + NEW MISSION
      </button>
      {/* panels.js:2520-2527 (wireTopbar's MEDIA handler): stands down any
          capture mode, clears the selection and opens the media library. */}
      <button
        className="tbtn"
        id="btn-media"
        type="button"
        title="MISSION MEDIA LIBRARY"
        onClick={() => openMediaLibrary()}
      >
        MEDIA
      </button>
      <button className="tbtn" id="btn-globe" type="button" onClick={onExitToOrbit}>
        GLOBE
      </button>
      <Clock />
    </>
  )
}
