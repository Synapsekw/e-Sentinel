// Ported (Phase 1E / Task 7) from assets/js/ui/panels.js:1517-1558
// (renderTrackPanel), :1566-1588 (refreshViewedTrack — see the "no marker
// element" note below), :1596-1608 (wireTrackWatch) and :1784-1822 (the
// TASK NEAREST DRONE / DISMISS / VIEW DRONE handlers).
//
// data is the track ID (never the object), so every render reads the
// current status straight off the engine — mirroring RequestPanel.tsx.
//
// Legacy's refreshViewedTrack used a hidden `#trk-panel-marker` element to
// diff the last-rendered status against the live one on a poll (full
// re-render on a status change, otherwise an in-place text patch of the
// age/expiry countdown only). That distinction existed purely to avoid a
// full innerHTML repaint every 2s; it has no analogue here — React
// re-renders this component from live engine state on the same 2s poll
// (and immediately on a TRACK_* engine event, wireTrackWatch's job), and
// reconciliation already limits the DOM writes to what actually changed.

import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { fmtETA, nowClockStr } from '@/modules/console/chrome/format'
import type { Engine, Mission, SimEvent, Track } from '@/modules/console/domain'
import { selectEntity } from '@/modules/console/selection'
import { applyPanel } from '@/modules/console/selection/selectEntity'
import { useAppStore } from '@/shared/store'
import { useOptionalEngine, useOptionalMap } from './hooks'
import { TRACK_EXPIRY_AMBER_S, TRACK_STATUS_CHIP, trackAgeStr, trackExpiryS } from './trackModel'
import './review.css'

export interface TrackPanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

const REFRESH_MS = 2000 // legacy's 2s poll cadence, panels.js:2735-2737

export default function TrackPanel({ id, engine: engineProp, map: mapProp }: TrackPanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  // wireTrackWatch, panels.js:1596-1608: any TRACK_* event re-renders this
  // panel immediately instead of waiting out the poll.
  useEffect(() => {
    if (!engine) return
    const cb = (ev: SimEvent) => {
      const code = ev.code ? String(ev.code) : ''
      if (code.indexOf('TRACK_') !== 0) return
      setTick((t) => t + 1)
    }
    engine.onEvent(cb)
    return () => engine.offEvent(cb)
  }, [engine])

  const trackOrMissing = engine ? (engine.tracks.get(id) ?? null) : null

  if (!trackOrMissing) {
    return (
      <>
        <div className="lbl">Detection track</div>
        <div className="rp-empty">TRACK NOT FOUND · MAY HAVE EXPIRED</div>
      </>
    )
  }
  // Control-flow narrowing from the guard above does not survive into the
  // closures below (handleTask/handleDismiss/handleViewDrone) — a fresh
  // `const` typed as non-nullable Track sidesteps needing a `!` assertion at
  // every one of those use sites (same pattern as DroneTelemetryPanel.tsx).
  const track: Track = trackOrMissing

  const chip = TRACK_STATUS_CHIP[track.status] || TRACK_STATUS_CHIP.active
  const pos = Array.isArray(track.pos) ? track.pos : [0, 0]
  const isActive = track.status === 'active'
  const remainS = trackExpiryS(engine, track)

  // panels.js:1783-1804. taskTrack throws (e.g. 'NO READY DOCK IN RANGE')
  // rather than failing silently — surfaced as a warn ticker advisory,
  // never a crash.
  function handleTask(): void {
    if (!engine) {
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: 'OPS',
        message: 'TRACK TASKING UNAVAILABLE · ENGINE OFFLINE',
        level: 'warn',
        droneId: null,
      })
      return
    }
    let mission: Mission
    try {
      mission = engine.taskTrack(id)
    } catch (err) {
      const msg = err instanceof Error ? String(err.message).toUpperCase() : 'UNKNOWN'
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: 'OPS',
        message: 'TRACK TASKING FAILED · ' + msg,
        level: 'warn',
        droneId: null,
      })
      return
    }
    useAppStore.getState().addUserMission(mission.id)
    const droneId = 'D-' + mission.dockId
    useAppStore.getState().setFollowDroneId(droneId)
    selectEntity({ type: 'drone', id: droneId }, engine, map)
  }

  // panels.js:1806-1811.
  function handleDismiss(): void {
    engine?.dismissTrack(id)
    applyPanel({ mode: 'empty' })
  }

  // panels.js:1813-1822: tasked track -> jump to the drone already
  // investigating it.
  function handleViewDrone(): void {
    if (!engine) return
    const mission = track.missionId ? engine.missions.get(track.missionId) : null
    if (!mission) return
    const droneId = 'D-' + mission.dockId
    if (engine.drones.get(droneId)) selectEntity({ type: 'drone', id: droneId }, engine, map)
  }

  return (
    <>
      <div className="lbl">Detection track</div>
      <div className="rp-id">TRACK · {track.id}</div>
      <div className="rp-name">{track.label}</div>
      <div className={'state-chip trk-chip' + (chip.cls ? ' ' + chip.cls : '')}>{chip.text}</div>
      <div className="rp-kv">
        <span className="k">Source drone</span>
        <span className="v">{track.sourceDrone ? track.sourceDrone : '—'}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Origin mission</span>
        <span className="v">{track.sourceMission ? track.sourceMission : '—'}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Detected</span>
        <span className="v" id="trk-age">
          {trackAgeStr(engine, track)}
        </span>
      </div>
      {isActive && (
        <div className="rp-kv">
          <span className="k">Expiry</span>
          <span
            className={'v trk-expiry' + (remainS < TRACK_EXPIRY_AMBER_S ? ' amber' : '')}
            id="trk-expiry"
          >
            EXPIRES IN {fmtETA(remainS)}
          </span>
        </div>
      )}
      <div className="rp-kv">
        <span className="k">Position</span>
        <span className="v">
          {Number(pos[1]).toFixed(4)}, {Number(pos[0]).toFixed(4)}
        </span>
      </div>
      {track.status === 'tasked' && (
        <>
          <div className="trk-investigating">
            INVESTIGATING · {track.missionId ? track.missionId : '—'}
          </div>
          <div className="rp-actions">
            <button type="button" className="ghost" id="trk-view-drone" onClick={handleViewDrone}>
              VIEW DRONE
            </button>
          </div>
        </>
      )}
      {isActive && (
        <div className="rp-actions">
          <button type="button" className="primary" id="trk-task" onClick={handleTask}>
            TASK NEAREST DRONE
          </button>
          <button type="button" className="ghost" id="trk-dismiss" onClick={handleDismiss}>
            DISMISS
          </button>
        </div>
      )}
    </>
  )
}
