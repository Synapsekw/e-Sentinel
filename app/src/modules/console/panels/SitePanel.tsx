// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:341-345
// (SITE_STATUS_CHIP), :350-359 (nearestDockTo), :361-385 (renderSitePanel)
// and :1696-1735 (wireRightPanelActions's site branch): #rp-site-locate
// flies the camera, #rp-site-dock jumps to the nearest dock via
// selectEntity, and #rp-site-dispatch runs the FULL engine.launchPreset
// flow — including its ticker advisories on failure and the
// follow-the-launched-drone success path. This is NOT a Phase 1E seam:
// launchPreset already exists on the domain Engine (Phase 1A).
//
// No live-refresh interval here (unlike DockPanel/DronePanel/OpsDigest): a
// site's status/coordinates are static seed data and nearestDockTo reads
// only DATA_DOCKS' fixed coordinates, so there is nothing for a poll to
// pick up.

import type maplibregl from 'maplibre-gl'
import { DATA_DOCKS, SimRouter } from '@/modules/console/domain'
import type { DockSeed, Engine, LonLat, Site } from '@/modules/console/domain'
import { SITE_INDEX } from '@/modules/console/selection/selectEntity'
import { selectEntity } from '@/modules/console/selection'
import { useAppStore } from '@/shared/store'
import { nowClockStr } from '@/modules/console/chrome/format'
import { useOptionalEngine, useOptionalMap } from './hooks'

export interface SitePanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

// panels.js:341-345.
const SITE_STATUS_CHIP: Record<Site['status'], { cls: string; text: string }> = {
  installed: { cls: '', text: 'INSTALLED · LIVE' },
  'not-installed': { cls: 'amber', text: 'NOT INSTALLED' },
  replace: { cls: 'red', text: 'NEEDS REPLACEMENT' },
}

// panels.js:350-359. Closest dock to an arbitrary point, using SimRouter's
// metric distance (this port's Engine/SimRouter is never optional the way
// legacy's `window.SimRouter` global read could be).
function nearestDockTo(coords: LonLat): { dock: DockSeed; km: number } | null {
  let best: DockSeed | null = null
  let bestM = Infinity
  for (const d of DATA_DOCKS) {
    const m = SimRouter.distM(coords, d.coords)
    if (m < bestM) {
      bestM = m
      best = d
    }
  }
  return best ? { dock: best, km: bestM / 1000 } : null
}

export default function SitePanel({ id, engine: engineProp, map: mapProp }: SitePanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

  const siteOrMissing = SITE_INDEX.get(id)
  if (!siteOrMissing) return null
  // TypeScript's control-flow narrowing from the guard above does not
  // survive into the closures below (handleDispatch/handleNearestDock and
  // the LOCATE button's onClick) — a fresh `const` typed as non-nullable
  // Site sidesteps needing a `!` assertion at every one of those use sites.
  const site: Site = siteOrMissing

  const chip = SITE_STATUS_CHIP[site.status] || SITE_STATUS_CHIP.installed
  const [lon, lat] = site.coords
  const dispatchLabel = site.status === 'not-installed' ? 'SURVEY SITE' : 'DISPATCH INSPECTION'
  const near = nearestDockTo(site.coords)

  // panels.js:1717-1735.
  function handleDispatch() {
    if (!engine) {
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: site.id,
        message: 'INSPECTION UNAVAILABLE · ENGINE OFFLINE',
        level: 'warn',
        droneId: null,
      })
      return
    }
    try {
      const mission = engine.launchPreset('infra', { near: site.coords })
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: site.id,
        message: 'INSPECTION DISPATCHED · ' + site.id + ' · FROM ' + mission.dockId,
        level: 'info',
        droneId: null,
      })
      const droneId = 'D-' + mission.dockId
      if (engine.drones.get(droneId)) {
        useAppStore.getState().setFollowDroneId(droneId)
        selectEntity({ type: 'drone', id: droneId }, engine, map ?? null)
      }
    } catch {
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: site.id,
        message: 'NO DRONE AVAILABLE FOR INSPECTION',
        level: 'warn',
        droneId: null,
      })
    }
  }

  // panels.js:1704-1708.
  function handleNearestDock() {
    const n = nearestDockTo(site.coords)
    if (n) selectEntity({ type: 'dock', id: n.dock.id }, engine ?? null, map ?? null)
  }

  return (
    <>
      <div className="rp-id">{site.id}</div>
      <div className="rp-name">{site.name}</div>
      <div className="rp-kv">
        <span className="k">Coordinates</span>
        <span className="v">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      </div>
      {near ? (
        <div className="rp-kv">
          <span className="k">Nearest dock</span>
          <span className="v">
            {near.dock.name} · {near.km.toFixed(1)} KM
          </span>
        </div>
      ) : null}
      <div className={'state-chip' + (chip.cls ? ' ' + chip.cls : '')}>{chip.text}</div>
      <div className="lbl" style={{ marginTop: 14 }}>
        E& TOWER SITE · LIVE NETWORK
      </div>
      <div className="rp-actions">
        <button type="button" className="primary" id="rp-site-dispatch" onClick={handleDispatch}>
          {dispatchLabel}
        </button>
        <button
          type="button"
          className="ghost"
          id="rp-site-locate"
          onClick={() => map?.flyTo({ center: site.coords, zoom: 14 })}
        >
          LOCATE
        </button>
        <button type="button" className="ghost" id="rp-site-dock" onClick={handleNearestDock}>
          NEAREST DOCK
        </button>
      </div>
    </>
  )
}
