// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:317-337
// (renderDockPanel) and :1636-1644 (wireRightPanelActions's dock branch:
// #rp-locate flies the camera; #rp-launch dispatches to the mission
// wizard). Refreshes on a 1000ms interval so battery/state stay live while
// the card is open — this replaces legacy's setRightPanel/updateOpsDigest
// interval bookkeeping with this component's own effect cleanup (see
// RightPanel.tsx's header comment).
//
// Phase 1E / Task 3: #rp-launch now calls control/useWizard.ts's
// enterWizard(dock.id) (control.js's control.enterWizard, wired at
// panels.js:1641-1644) and is enabled exactly when the dock is available to
// launch from (`launchAvailable`, unchanged from Phase 1D).

import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Engine } from '@/modules/console/domain'
import { EMIRATE_NAMES } from '@/modules/console/chrome/emirates'
import { batteryFor, stateFor } from '@/modules/console/chrome/dockModel'
import { DOCK_INDEX } from '@/modules/console/selection/selectEntity'
import { useWizard } from '@/modules/console/control/useWizard'
import { useOptionalEngine, useOptionalMap } from './hooks'

export interface DockPanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

const REFRESH_MS = 1000

export default function DockPanel({ id, engine: engineProp, map: mapProp }: DockPanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap
  const { enterWizard } = useWizard()

  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  const dock = DOCK_INDEX.get(id)
  if (!dock) return null

  const battery = batteryFor(engine, id)
  const state = stateFor(engine, dock)
  const emirate = EMIRATE_NAMES[dock.emirate] || dock.emirate
  const launchAvailable = state === 'ready' // panels.js:321
  const launchTitle = launchAvailable ? undefined : 'DRONE NOT AVAILABLE AT THIS DOCK' // panels.js:322

  return (
    <>
      <div className="rp-id">{dock.id}</div>
      <div className="rp-name">{dock.name}</div>
      <div className="rp-emirate">{emirate}</div>
      <div className="rp-kv">
        <span className="k">Drone model</span>
        <span className="v">{dock.model}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Battery</span>
        <span className="v">{battery}%</span>
      </div>
      <div className="batt-bar">
        <i style={{ width: battery + '%' }} />
      </div>
      <div className="state-chip">{state.toUpperCase()}</div>
      <div className="rp-actions">
        <button
          type="button"
          className="primary"
          id="rp-launch"
          disabled={!launchAvailable}
          title={launchTitle}
          onClick={() => enterWizard(dock.id)}
        >
          LAUNCH MISSION
        </button>
        <button
          type="button"
          className="ghost"
          id="rp-locate"
          onClick={() => map?.flyTo({ center: dock.coords, zoom: 14 })}
        >
          LOCATE
        </button>
      </div>
    </>
  )
}
