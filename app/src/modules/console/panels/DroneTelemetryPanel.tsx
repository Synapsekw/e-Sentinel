// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:513-554
// (renderDronePanel), :561-628 (updateDroneTelemetry's 2 Hz live refresh —
// folded into a single interval-driven re-render here, since React
// reconciliation replaces the innerHTML dirty-check that function did by
// hand) and :1652-1695 (wireRightPanelActions's drone branch: #rp-follow,
// #rp-rtb, #rp-hold, #rp-control, #rp-alt-dn/#rp-alt-up).
//
// The 500ms refresh bumps a local counter to force a re-render from live
// engine state (the plan's "push nothing into the store" rule) — this
// replaces legacy's droneTeleTimer module global, whose lifecycle is now
// this component's own effect cleanup (see RightPanel.tsx's header
// comment).
//
// #rp-control is unconditionally disabled: manual control (control.js)
// lands in Phase 1E. The alt row (#rp-alt-row) only ever shows for
// drone.state === 'manual', which is unreachable before Phase 1E lands, so
// it renders `hidden` by construction here — but its buttons are still
// wired to the real (already-existing) engine.nudgeAlt, exactly as legacy,
// since nudgeAlt is not itself a Phase 1E seam.
//
// Deviation from the plan's proposed filename (DronePanel.tsx): this repo
// checkout lives on a case-insensitive filesystem (Windows/NTFS), and
// having both `dronePanel.ts` (the pure model, imported below) and
// `DronePanel.tsx` in the same directory made Vite's module graph resolve
// one of the two incorrectly (the component import came back `undefined`
// at RightPanel's render time — reproduced via `npm run test`). Renaming
// only this file to `DroneTelemetryPanel.tsx` removes the case-only
// collision; the component's own name/behavior/exports are unchanged, and
// `dronePanel.ts` keeps its plan-specified name since dronePanel.test.ts
// imports it by that exact path.

import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Drone, Engine } from '@/modules/console/domain'
import { battLevel, padHeading } from '@/modules/console/chrome/format'
import { useAppStore } from '@/shared/store'
import { distHomeKm, fpvSources, holdDisabled, missionLineFor, rtbDisabled } from './dronePanel'
import FpvFrame from './FpvFrame'
import { useOptionalEngine, useOptionalMap } from './hooks'

export interface DronePanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

const REFRESH_MS = 500 // 2 Hz, panels.js:430/561.
const FOLLOW_EASE_ZOOM = 12.5
const FOLLOW_EASE_DURATION_MS = 600 // panels.js:1660 (distinct from useFollowDriver's 950ms per-tick ease).

// panels.js:409-417 (teleCell). Local to this file — not part of the
// dronePanel.ts pure-model interface.
function TeleCell({
  teleKey,
  label,
  value,
  battLevelAttr,
}: {
  teleKey: string
  label: string
  value: string
  battLevelAttr?: 'ok' | 'amber' | 'red'
}) {
  return (
    <div className="tele-cell" data-tele={teleKey} data-batt-level={battLevelAttr}>
      <span className="tk">{label}</span>
      <span className="tv" id={'tv-' + teleKey}>
        {value}
      </span>
    </div>
  )
}

export default function DronePanel({ id, engine: engineProp, map: mapProp }: DronePanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

  const followDroneId = useAppStore((s) => s.followDroneId)
  const setFollowDroneId = useAppStore((s) => s.setFollowDroneId)

  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  const droneOrMissing = engine ? engine.drones.get(id) : null
  if (!droneOrMissing) return null
  // TypeScript's control-flow narrowing from the guard above does not
  // survive into the closures below (handleFollow/handleRtb/handleHold and
  // the alt-row buttons' onClick) — a fresh `const` typed as non-nullable
  // Drone sidesteps needing a `!` assertion at every one of those use sites.
  const drone: Drone = droneOrMissing

  const battery = Math.round(drone.battery)
  const following = followDroneId === drone.id
  const isManual = drone.state === 'manual'
  const isHeld = drone.state === 'hold'
  const sources = fpvSources(engine, drone)

  // panels.js:1654-1665.
  function handleFollow() {
    const turningOn = followDroneId !== drone.id
    setFollowDroneId(turningOn ? drone.id : null)
    if (turningOn && map) {
      map.easeTo({ center: drone.pos, zoom: FOLLOW_EASE_ZOOM, duration: FOLLOW_EASE_DURATION_MS })
    }
  }

  // panels.js:1666-1669.
  function handleRtb() {
    engine?.commandRTB(drone.id)
  }

  // panels.js:1671-1677.
  function handleHold() {
    if (!engine) return
    const d = engine.drones.get(drone.id)
    if (!d) return
    engine.commandHold(drone.id, d.state !== 'hold')
  }

  return (
    <>
      <div className="rp-id">{drone.id}</div>
      <div className="rp-name">
        {drone.model} · HOME {drone.dockId}
      </div>
      <div className="rp-mission" id="rp-mission-line">
        {missionLineFor(engine, drone)}
      </div>

      <div className="tele-grid">
        <TeleCell teleKey="alt" label="ALT" value={Math.round(drone.alt) + ' M'} />
        <TeleCell teleKey="spd" label="SPD" value={drone.speedMs.toFixed(1) + ' M/S'} />
        <TeleCell teleKey="hdg" label="HDG" value={padHeading(drone.heading) + '°'} />
        <TeleCell
          teleKey="bat"
          label="BAT"
          value={battery + '%'}
          battLevelAttr={battLevel(battery)}
        />
        <TeleCell teleKey="link" label="LINK" value="O3+ · -62 DBM" />
        <TeleCell
          teleKey="dist"
          label="DIST HOME"
          value={distHomeKm(engine, drone).toFixed(1) + ' KM'}
        />
      </div>

      <FpvFrame drone={drone} sources={sources} />

      <div className="rp-actions">
        <button
          type="button"
          className={'ghost' + (following ? ' on' : '')}
          id="rp-follow"
          onClick={handleFollow}
        >
          {following ? 'FOLLOWING' : 'FOLLOW'}
        </button>
        <button
          type="button"
          className={'ghost' + (isManual ? ' on' : '')}
          id="rp-control"
          disabled // Phase 1E: enterManual(droneId) — manual control (control.js) lands then.
        >
          {isManual ? 'RELEASE' : 'TAKE CONTROL'}
        </button>
      </div>
      <div className="rp-actions rp-alt-row" id="rp-alt-row" hidden={!isManual}>
        <button
          type="button"
          className="ghost"
          id="rp-alt-dn"
          onClick={() => engine?.nudgeAlt(drone.id, -10)}
        >
          ALT -10M
        </button>
        <button
          type="button"
          className="ghost"
          id="rp-alt-up"
          onClick={() => engine?.nudgeAlt(drone.id, 10)}
        >
          ALT +10M
        </button>
      </div>
      <div className="rp-actions">
        <button
          type="button"
          className="primary"
          id="rp-rtb"
          disabled={rtbDisabled(drone)}
          onClick={handleRtb}
        >
          RETURN TO DOCK
        </button>
        <button
          type="button"
          className="ghost"
          id="rp-hold"
          disabled={holdDisabled(drone)}
          onClick={handleHold}
        >
          {isHeld ? 'RESUME' : 'PAUSE'}
        </button>
      </div>
    </>
  )
}
