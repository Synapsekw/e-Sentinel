// Ported (Phase 1E / Task 5) from assets/js/ui/panels.js:779-810
// (renderDebriefPanel) and :862-872 (exportMissionReport — the DOM half;
// the payload string itself is debriefModel.ts's missionReportText).
//
// DATA SOURCE: RightPanelState's `{ mode: 'debrief'; id: string }` (Phase
// 1E / Task 1) carries only the mission id, matching every other Task 1D/E
// right-panel mode — but unlike dock/drone/site, a completed mission isn't
// necessarily still in `engine.missions` (finalizeMission's
// pruneFinishedMissions can evict it once more than 60 finished missions
// have accumulated). The store's `sessionMissions` list (capped at 40 by
// useDebriefWatch.ts's recordCompletedMission, independent of the engine's
// own pruning) is the durable record this panel reads from instead.

import { useAppStore } from '@/shared/store'
import type maplibregl from 'maplibre-gl'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import type { Engine, Mission } from '@/modules/console/domain'
import { fmtMMSS, nowClockStr } from '@/modules/console/chrome/format'
import { analyticsEntries, missionReportText, routeGeometry } from './debriefModel'
import RouteSvg from './RouteSvg'
import DebriefVideo from './DebriefVideo'
import './debrief.css'

export interface DebriefPanelProps {
  id: string
  engine?: Engine | null
  map?: maplibregl.Map | null
}

// panels.js:862-872. A blank about:blank popup is written synchronously,
// then printed — works from file:// and needs no external assets. Kept a
// module-private function (not exported) so this file's react-refresh
// export surface stays limited to the default component.
function exportMissionReport(mission: Mission): void {
  let w: Window | null = null
  try {
    w = window.open('', '_blank')
  } catch {
    w = null
  }
  if (!w) {
    useAppStore.getState().pushTickerEvent({
      time: nowClockStr(),
      level: 'warn',
      source: 'OPS',
      message: 'EXPORT BLOCKED · ALLOW POPUPS',
      droneId: null,
    })
    return
  }
  w.document.write(missionReportText(mission))
  w.document.close()
  w.focus()
}

export default function DebriefPanel({ id }: DebriefPanelProps) {
  const mission = useAppStore((s) => s.sessionMissions.find((m) => m.id === id))
  if (!mission) return null

  const cfg = MISSIONS_CONFIG[mission.type]
  const hasRoute = routeGeometry(mission.waypoints) !== null
  const entries = analyticsEntries(mission)

  return (
    <>
      <div className="lbl">Mission debrief</div>
      <div className="rp-id">{mission.id}</div>
      <div className="rp-name">{cfg.label}</div>
      <div className="rp-kv">
        <span className="k">Dock</span>
        <span className="v">{mission.dockId}</span>
      </div>
      {mission.requestedBy ? (
        <div className="rp-kv">
          <span className="k">Requested by</span>
          <span className="v">{mission.requestedBy}</span>
        </div>
      ) : null}
      {mission.trackId ? (
        <div className="rp-kv">
          <span className="k">Track response</span>
          <span className="v">{mission.trackId}</span>
        </div>
      ) : null}
      <div className="rp-kv">
        <span className="k">Duration</span>
        <span className="v">{fmtMMSS(mission.durationS)}</span>
      </div>
      <div className="rp-kv">
        <span className="k">Distance</span>
        <span className="v">{(mission.distanceKm || 0).toFixed(1)} KM</span>
      </div>

      {hasRoute ? (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>
            Route snapshot
          </div>
          <div className="debrief-route">
            <RouteSvg waypoints={mission.waypoints} />
          </div>
        </>
      ) : null}

      <div className="lbl" style={{ marginTop: 16 }}>
        Mission analytics
      </div>
      {entries.length === 0 ? (
        <p className="lbl" style={{ marginTop: 10 }}>
          NO ANALYTICS CAPTURED
        </p>
      ) : (
        <dl className="rp-analytics">
          {entries.map((e) => (
            <div className="rp-kv" key={e.label}>
              <dt className="k">{e.label}</dt>
              <dd className="v">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <DebriefVideo mission={mission} />

      <div className="rp-actions">
        <button
          type="button"
          className="ghost"
          id="db-export"
          onClick={() => exportMissionReport(mission)}
        >
          EXPORT REPORT
        </button>
      </div>
    </>
  )
}
