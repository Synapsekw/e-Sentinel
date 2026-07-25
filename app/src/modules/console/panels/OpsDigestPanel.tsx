// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:258-275
// (renderEmptyPanel), :280-315 (updateOpsDigest's 1 Hz refresh — folded
// into a single interval-driven re-render here, since React reconciliation
// replaces the innerHTML dirty-check that function did by hand), :219-223
// (detectionEventTrack), :1828-1838 (the digest-missions delegated click
// listener) and :1840-1852 (the digest-detections delegated click
// listener, i.e. the still-live-track jump).
//
// The 1 Hz refresh bumps a local counter to force a re-render from live
// engine state (the plan's "push nothing into the store" rule) — this
// replaces legacy's digestTimer module global, whose lifecycle is now this
// component's own effect cleanup (see RightPanel.tsx's header comment).
//
// Deviation from the plan's proposed filename (OpsDigest.tsx): this repo
// checkout lives on a case-insensitive filesystem (Windows/NTFS), and
// having both `opsDigest.ts` (the pure model, imported below) and
// `OpsDigest.tsx` in the same directory made Vite's module graph resolve
// one of the two incorrectly (the component import came back `undefined`
// at RightPanel's render time — reproduced via `npm run test`). Renaming
// only this file to `OpsDigestPanel.tsx` removes the case-only collision;
// the component's own name/behavior/exports are unchanged, and
// `opsDigest.ts` keeps its plan-specified name since opsDigest.test.ts
// imports it by that exact path.

import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import type { Engine, SimEvent } from '@/modules/console/domain'
import { fmtETA, fmtMMSS } from '@/modules/console/chrome/format'
import { inCaptureMode, selectEntity } from '@/modules/console/selection'
import { focusTrack } from '@/modules/console/selection/useMapTrackInteractions'
import { useOptionalEngine, useOptionalMap } from './hooks'
import { detectionBody, digestActiveMissions, digestStatsLine, lastDetections } from './opsDigest'

export interface OpsDigestProps {
  engine?: Engine | null
  map?: maplibregl.Map | null
}

const REFRESH_MS = 1000
const LAST_DETECTIONS_COUNT = 3

export default function OpsDigest({ engine: engineProp, map: mapProp }: OpsDigestProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap

  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  const statsLine = digestStatsLine(engine)
  const missions = digestActiveMissions(engine)
  const dets = lastDetections(engine, LAST_DETECTIONS_COUNT)

  // panels.js:1832-1838.
  function handleMissionRowClick(droneId: string) {
    if (inCaptureMode() || !engine) return
    const drone = engine.drones.get(droneId)
    if (drone && drone.state !== 'docked') {
      selectEntity({ type: 'drone', id: droneId }, engine, map ?? null)
    }
  }

  return (
    <div id="ops-digest">
      <div className="lbl">Ops digest · national activity</div>
      <div className="digest-stats" id="digest-stats">
        {statsLine}
      </div>

      <div className="lbl" style={{ marginTop: 16 }}>
        Active missions
      </div>
      <div className="digest-missions" id="digest-missions">
        {missions.length === 0 ? (
          <div className="lbl empty-note">NO ACTIVE MISSIONS · GRID AT READINESS</div>
        ) : (
          missions.map((m) => {
            const cfg = MISSIONS_CONFIG[m.type]
            const pct = Math.round((m.progress || 0) * 100)
            const eta = fmtETA((m.durationS || 0) * (1 - (m.progress || 0)))
            const droneId = 'D-' + m.dockId
            return (
              <button
                type="button"
                key={m.id}
                className="digest-row"
                data-mid={m.id}
                data-drone={droneId}
                onClick={() => handleMissionRowClick(droneId)}
              >
                <span className="dg-head">
                  <span className="dg-type">{cfg.label}</span>
                  <span className="dg-eta">ETA {eta}</span>
                </span>
                <span className="dg-id">
                  {m.id} · {m.dockId}
                </span>
                <span className="dg-prog">
                  <i style={{ width: pct + '%' }} />
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="lbl" style={{ marginTop: 16 }}>
        Last detections
      </div>
      <div className="digest-dets" id="digest-detections">
        {dets.length === 0 ? (
          <div className="lbl empty-note">NO DETECTIONS LOGGED YET</div>
        ) : (
          dets.map((ev: SimEvent, i) => {
            const body = detectionBody(ev)
            const inner = (
              <>
                <span className="tt">T+{fmtMMSS(ev.time)}</span>
                <span className="src">{ev.source}</span>
                <span className="msg">{body}</span>
              </>
            )
            // panels.js:219-223 (detectionEventTrack): a detection that
            // spawned a track still worth jumping to (active/tasked)
            // becomes a button; everything else stays inert text.
            const track = ev.trackId && engine ? engine.tracks.get(ev.trackId) : undefined
            const isLiveTrack = !!track && (track.status === 'active' || track.status === 'tasked')
            const key = ev.time + '|' + ev.source + '|' + i
            if (isLiveTrack && track) {
              return (
                <button
                  type="button"
                  key={key}
                  className="dg-det dg-det-track"
                  title={'OPEN ' + track.id}
                  onClick={() => {
                    // panels.js:1845-1850: fly the camera + open the track
                    // review panel (Phase 1E / Task 7's TrackPanel.tsx).
                    if (inCaptureMode()) return
                    focusTrack(track.id, engine, map)
                  }}
                >
                  {inner}
                </button>
              )
            }
            return (
              <div key={key} className="dg-det">
                {inner}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
