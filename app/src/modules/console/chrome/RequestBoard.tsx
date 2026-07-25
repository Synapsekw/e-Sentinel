// Ported (Phase 1D / Task 6) from console.html:58-75 (the `.panel.
// side-requests` FLIGHT REQUESTS board skeleton), assets/js/ui/panels.js:
// 1146-1267 (reqRowHTML/reqProgressHTML/reqDoneHTML row markup -- their data
// derivation lives in requestBoard.ts), :1313-1342 (renderRequestList's
// badge + section-hidden + empty-note rules), :1351-1374 (wireRequestList's
// row-click routing) and :1444-1459 (wireRequestWatch's FLIGHT_REQUEST /
// REQUEST_* event subscription).
//
// Legacy's patch path (patchRequestBoard, panels.js:1281-1302) kept row DOM
// stable across the 2s poll and only touched `[data-req-age]`/
// `[data-req-eta]`/`[data-req-bar]`/`[data-req-done]` text/width in place so
// hover/focus survived. React re-renders the whole board from scratch on
// every tick instead (reconciliation gives the same "no full repaint" result
// for free), so those patch-target data attributes have no analogue here --
// only `data-req` (the click-delegation key) is carried over.
//
// The pure data model lives in `requestModel.ts` (named to avoid a
// case-only collision with this file on case-insensitive checkouts, which
// makes bare-specifier module resolution ambiguous).

import { useContext, useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { MapContext } from '@/modules/console/map/MapContext'
import type { Engine, FlightRequest, SimEvent } from '@/modules/console/domain'
import { inCaptureMode, selectEntity } from '@/modules/console/selection'
import { useAppStore } from '@/shared/store'
import {
  REQ_PRI_CLASS,
  missionTypeLabel,
  reqAgeStr,
  reqProgress,
  requestBuckets,
  requestMission,
} from './requestModel'

const REQUEST_POLL_MS = 2000 // legacy's 2s poll cadence, panels.js:2735-2737

// RequestBoard.test.tsx renders <RequestBoard engine={...}/> directly with
// no <EngineProvider>/<MapView> in the tree -- useEngine()/useMap() would
// throw there. useContext() never throws, so reading the contexts directly
// (returning null without a provider) lets the explicit prop win when given
// and otherwise falls back to the live context. Same optional-prop pattern
// as DockList (Task 5) / RightPanel (Task 7).
function useOptionalEngine(explicit: Engine | null | undefined): Engine | null {
  const ctx = useContext(EngineContext)
  if (explicit !== undefined) return explicit
  return ctx ? ctx.engineRef.current : null
}

function useOptionalMap(): maplibregl.Map | null {
  const ctx = useContext(MapContext)
  return ctx ? ctx.mapRef.current : null
}

export interface RequestBoardProps {
  engine?: Engine | null
}

interface RowProps {
  engine: Engine | null
  req: FlightRequest
}

// NEW row. panels.js:1201-1211 (reqRowHTML).
function NewRow({ engine, req, onClick }: RowProps & { onClick: (req: FlightRequest) => void }) {
  const pri = String(req.priority || 'ROUTINE').toUpperCase()
  const priCls = REQ_PRI_CLASS[pri] || 'routine'
  return (
    <button className="req-row" data-req={req.id ?? ''} onClick={() => onClick(req)}>
      <span className="req-head">
        <span className={'req-pri ' + priCls}>{pri}</span>
        <b className="req-cust">{req.customer}</b>
        <span className="req-age">{reqAgeStr(engine, req)}</span>
      </span>
      <span className="req-line">
        {missionTypeLabel(req.type)} · {req.place}
      </span>
    </button>
  )
}

// IN PROGRESS row. panels.js:1216-1228 (reqProgressHTML).
function ActiveRow({ engine, req, onClick }: RowProps & { onClick: (req: FlightRequest) => void }) {
  const { pct, eta } = reqProgress(engine, req)
  return (
    <button className="req-row req-prog" data-req={req.id ?? ''} onClick={() => onClick(req)}>
      <span className="req-head">
        <b className="req-cust">{req.customer}</b>
        <span className="req-age req-eta">{eta}</span>
      </span>
      <span className="req-line">
        {missionTypeLabel(req.type)} · {req.place}
      </span>
      <span className="req-bar">
        <i style={{ width: pct + '%' }} />
      </span>
    </button>
  )
}

// DELIVERED row: declined renders dim + inert (a <div>, panels.js:1236-1245);
// completed renders a clickable <button> when its mission is still
// reachable, else an inert <div class="req-inert"> (panels.js:1246-1256).
function DoneRow({ engine, req, onClick }: RowProps & { onClick: (req: FlightRequest) => void }) {
  const line = (
    <span className="req-line">
      {missionTypeLabel(req.type)} · {req.place}
    </span>
  )

  if (req.status === 'declined') {
    return (
      <div className="req-row req-done req-declined">
        <span className="req-head">
          <b className="req-cust">{req.customer}</b>
          <span className="req-age">DECLINED</span>
        </span>
        {line}
      </div>
    )
  }

  const age = 'DELIVERED · ' + reqAgeStr(engine, req)
  const reachable = !!requestMission(engine, req)

  if (!reachable) {
    return (
      <div className="req-row req-done req-inert" data-req={req.id ?? ''}>
        <span className="req-head">
          <b className="req-cust">{req.customer}</b>
          <span className="req-age">{age}</span>
        </span>
        {line}
      </div>
    )
  }

  return (
    <button className="req-row req-done" data-req={req.id ?? ''} onClick={() => onClick(req)}>
      <span className="req-head">
        <b className="req-cust">{req.customer}</b>
        <span className="req-age">{age}</span>
      </span>
      {line}
    </button>
  )
}

export default function RequestBoard({ engine: engineProp }: RequestBoardProps = {}) {
  const engine = useOptionalEngine(engineProp)
  const map = useOptionalMap()

  // Forces a re-render on the 2s poll (patchRequestBoard's replacement,
  // see the header comment) and immediately on a matching engine event
  // (wireRequestWatch, panels.js:1444-1459) so a new request lands without
  // waiting out the poll.
  const [, forceRefresh] = useState(0)

  useEffect(() => {
    const id = setInterval(() => forceRefresh((n) => n + 1), REQUEST_POLL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!engine) return
    const cb = (ev: SimEvent) => {
      const code = ev.code ? String(ev.code) : ''
      if (code !== 'FLIGHT_REQUEST' && code.indexOf('REQUEST_') !== 0) return
      forceRefresh((n) => n + 1)
    }
    engine.onEvent(cb)
    return () => engine.offEvent(cb)
  }, [engine])

  const buckets = requestBuckets(engine)
  const empty =
    buckets.pending.length === 0 && buckets.active.length === 0 && buckets.done.length === 0

  // NEW row click (panels.js:1358-1361): jump the map to the customer site
  // and open the review panel. The selection stays as-is, matching legacy's
  // comment that a request is not a map entity -- the review panel rides on
  // the panel registry alone, looked up by id.
  function handlePendingClick(req: FlightRequest): void {
    if (inCaptureMode() || !req.id) return
    if (map && Array.isArray(req.coords)) map.flyTo({ center: req.coords, zoom: 12.2 })
    useAppStore.getState().setRightPanel({ mode: 'request', id: req.id })
  }

  // IN PROGRESS row click (panels.js:1362-1367): select the flying drone.
  function handleApprovedClick(req: FlightRequest): void {
    if (inCaptureMode() || !engine || !req.missionId) return
    const mission = engine.missions.get(req.missionId)
    if (!mission) return // still LAUNCHING (or mission pruned) -- nothing to jump to
    const droneId = 'D-' + mission.dockId
    if (engine.drones.get(droneId)) selectEntity({ type: 'drone', id: droneId }, engine, map)
  }

  // DELIVERED row click (panels.js:1368-1371): open the mission debrief.
  function handleCompletedClick(req: FlightRequest): void {
    if (inCaptureMode()) return
    const mission = requestMission(engine, req)
    if (!mission) return
    useAppStore.getState().setSelection(null)
    useAppStore.getState().setRightPanel({ mode: 'debrief', id: mission.id })
  }

  return (
    <div className="panel side-requests">
      <h4 className="lbl">
        Flight requests{' '}
        <span id="req-count" className="req-count" hidden={buckets.pending.length === 0}>
          {buckets.pending.length}
        </span>
      </h4>
      <div id="reqboard">
        <div className="lbl empty-note" id="req-empty" hidden={!empty}>
          NO REQUESTS YET · GRID AT READINESS
        </div>
        <div className="req-sec" id="req-sec-new" hidden={buckets.pending.length === 0}>
          <div className="lbl req-sec-h">New</div>
          <div id="reqlist" className="req-sec-list">
            {buckets.pending.map((req) => (
              <NewRow
                key={req.id ?? req.requestedAt}
                engine={engine}
                req={req}
                onClick={handlePendingClick}
              />
            ))}
          </div>
        </div>
        <div className="req-sec" id="req-sec-active" hidden={buckets.active.length === 0}>
          <div className="lbl req-sec-h">In progress</div>
          <div id="req-active" className="req-sec-list">
            {buckets.active.map((req) => (
              <ActiveRow
                key={req.id ?? req.requestedAt}
                engine={engine}
                req={req}
                onClick={handleApprovedClick}
              />
            ))}
          </div>
        </div>
        <div className="req-sec" id="req-sec-done" hidden={buckets.done.length === 0}>
          <div className="lbl req-sec-h">Delivered</div>
          <div id="req-done" className="req-sec-list">
            {buckets.done.map((req) => (
              <DoneRow
                key={req.id ?? req.requestedAt}
                engine={engine}
                req={req}
                onClick={handleCompletedClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
