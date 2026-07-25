// Ported (Phase 1E / Task 7) from assets/js/ui/panels.js:1381-1423
// (renderRequestPanel), :1426-1438 (refreshViewedRequest — see the "no
// marker element" note below), :1444-1459 (wireRequestWatch) and
// :1745-1776 (the APPROVE & LAUNCH / DECLINE handlers).
//
// data is the request ID (never the object), so every render reads the
// current status straight off the engine: a request approved/declined
// elsewhere (or by this panel's own buttons) always shows live state.
//
// Legacy's refreshViewedRequest used a hidden `#req-panel-marker` element to
// remember the last-rendered status and diff it against the live one on a
// poll. That trick exists only because legacy repainted via
// `innerHTML = renderer(data)` and had no other way to know "did the status
// actually change since last paint" without re-rendering unconditionally.
// React already re-renders this component from live engine state on the 2s
// poll below (and immediately on a REQUEST_*/FLIGHT_REQUEST engine event,
// wireRequestWatch's job) — there is nothing to diff and no DOM marker to
// keep in sync, so it is skipped entirely.

import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { SimRouter } from '@/modules/console/domain'
import type { Engine, Mission, SimEvent } from '@/modules/console/domain'
import { fmtMMSS, nowClockStr } from '@/modules/console/chrome/format'
import { REQ_PRI_CLASS, missionTypeLabel, reqAgeStr } from '@/modules/console/chrome/requestModel'
import { selectEntity } from '@/modules/console/selection'
import { applyPanel } from '@/modules/console/selection/selectEntity'
import { useAppStore } from '@/shared/store'
import { useOptionalEngine, useOptionalMap } from './hooks'
import RouteSvg from './RouteSvg'
import './review.css'

export interface RequestPanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

const REFRESH_MS = 2000 // legacy's 2s poll cadence, panels.js:2735-2737

export default function RequestPanel({ id, engine: engineProp, map: mapProp }: RequestPanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  // wireRequestWatch, panels.js:1444-1459: a new FLIGHT_REQUEST or any
  // REQUEST_* resolution re-renders this panel immediately instead of
  // waiting out the poll.
  useEffect(() => {
    if (!engine) return
    const cb = (ev: SimEvent) => {
      const code = ev.code ? String(ev.code) : ''
      if (code !== 'FLIGHT_REQUEST' && code.indexOf('REQUEST_') !== 0) return
      setTick((t) => t + 1)
    }
    engine.onEvent(cb)
    return () => engine.offEvent(cb)
  }, [engine])

  const req = engine ? (engine.requests.get(id) ?? null) : null

  if (!req) {
    return (
      <>
        <div className="lbl">Flight request</div>
        <div className="rp-empty">REQUEST NOT FOUND · MAY HAVE BEEN PRUNED</div>
      </>
    )
  }

  const pri = String(req.priority || 'ROUTINE').toUpperCase()
  const priCls = REQ_PRI_CLASS[pri] || 'routine'
  const wps = req.waypoints || []
  const distKm = wps.length > 1 ? SimRouter.pathLengthKm(wps) : 0
  const speed = Number(req.params.speedMs) || 0
  const durS = speed > 0 ? (distKm * 1000) / speed : 0
  const isPending = req.status === 'pending'

  // panels.js:1745-1767. approveRequest throws (e.g. 'NO READY DOCK IN
  // RANGE') rather than failing silently — surfaced as a warn ticker
  // advisory, never a crash.
  function handleApprove(): void {
    if (!engine) {
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: 'OPS',
        message: 'REQUEST APPROVAL UNAVAILABLE · ENGINE OFFLINE',
        level: 'warn',
        droneId: null,
      })
      return
    }
    let mission: Mission
    try {
      mission = engine.approveRequest(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN'
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: 'OPS',
        message: 'REQUEST APPROVAL FAILED · ' + msg,
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

  // panels.js:1769-1776.
  function handleDecline(): void {
    engine?.declineRequest(id)
    applyPanel({ mode: 'empty' })
  }

  return (
    <>
      <div className="lbl">Flight request</div>
      <div className="rp-id">{req.id ?? id}</div>
      <div className="rp-name">{req.customerFull || req.customer}</div>
      <div className="rp-emirate">{req.customer}</div>
      <div className={'state-chip req-pri-chip ' + priCls}>{pri}</div>
      <div className="rp-kv">
        <span className="k">Mission</span>
        <span className="v">{missionTypeLabel(req.type)}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Area</span>
        <span className="v">{req.place}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Requested</span>
        <span className="v">{reqAgeStr(engine, req)}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Altitude</span>
        <span className="v">{req.params.altM != null ? req.params.altM + ' M' : '—'}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Speed</span>
        <span className="v">{req.params.speedMs != null ? req.params.speedMs + ' M/S' : '—'}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Assigned dock</span>
        <span className="v">{req.dockId ? req.dockId : '—'}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Distance</span>
        <span className="v">{distKm.toFixed(1)} KM</span>
      </div>
      <div className="rp-kv">
        <span className="k">Est duration</span>
        <span className="v">{fmtMMSS(durS)}</span>
      </div>
      {wps.length > 1 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>
            Planned route
          </div>
          <div className="debrief-route">
            <RouteSvg waypoints={wps} />
          </div>
        </>
      )}
      {isPending ? (
        <div className="rp-actions">
          <button type="button" className="primary" id="req-approve" onClick={handleApprove}>
            APPROVE & LAUNCH
          </button>
          <button type="button" className="ghost" id="req-decline" onClick={handleDecline}>
            DECLINE
          </button>
        </div>
      ) : (
        <div className="state-chip req-status">{String(req.status).toUpperCase()}</div>
      )}
    </>
  )
}
