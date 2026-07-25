// Ported (Phase 1E / Task 6) from assets/js/ui/panels.js:1016-1055
// (renderMediaPanel) and :1057-1083 (wireMediaPanel — card click opens the
// debrief, type-filter chips). console.css:368-383 (.media-grid/.media-card/
// ...) and :498-501 (.media-filters/.media-card-poster) -> panels/media.css.
//
// Legacy re-rendered the whole panel body's innerHTML on every filter-chip
// click and toggled `card.hidden` in place afterward so poster <video>
// elements already carrying loaded metadata never got torn down
// (panels.js:1066-1078's comment). React's per-component re-render is
// already the equivalent of that "don't blow away the DOM subtree" intent —
// every card stays mounted across a filter change here too, only its
// `hidden` attribute flips — so the chip filter is plain component state
// instead of a DOM query/class dance.
//
// DATA SOURCE: the store's `sessionMissions` (Phase 1E / Task 5,
// recordCompletedMission in useDebriefWatch.ts), the same durable session
// record DebriefPanel.tsx reads from instead of engine.missions (which
// prunes finished missions once more than 60 have accumulated).
//
// CARD CLICK: mirrors openDebrief's panel swap (panels.js:1085-1091,
// `EC2.state.selection = null` + `setRightPanel('debrief', mission)`).
// openDebrief also stands down manual control / the mission wizard first,
// which selection/selectEntity.ts's shared openDebrief() does through the
// registerCaptureExits registry Console.tsx populates.
//
// CONTRACT: RightPanel.tsx (controller-owned) already mounts this as
// `<MediaPanel engine={engine} map={map} />` alongside every other
// right-panel mode component for uniformity, but the MEDIA library itself —
// like legacy's renderMediaPanel/wireMediaPanel — needs neither the engine
// nor the map: it reads entirely off `sessionMissions`. Both props are
// accepted (and unused) purely to satisfy that shared shape.

import { useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import type { Engine, Mission, MissionType } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { openDebrief } from '@/modules/console/selection'
import { analyticsSummaryLine, timeHHMM } from './debriefModel'
import type { DebriefMission } from './debriefModel'
import { mediaFilterTypes, mediaPosterSrc } from './mediaModel'
import './media.css'

export interface MediaPanelProps {
  engine?: Engine | null
  map?: maplibregl.Map | null
}

type FilterValue = 'ALL' | MissionType

// The poster <video> for six of the seven mission types (every non-security
// clip in VIDEO_MANIFEST) points at a file that does not exist on disk —
// see mediaModel.ts's mediaPosterSrc comment. Rather than let that surface
// as a broken-video icon inside the card, this swaps to a CSS-only fallback
// tile (`.media-card-poster-fallback`, styled in media.css) the first time
// the element fails to load.
function MediaCardPoster({ type }: { type: MissionType }) {
  const src = mediaPosterSrc(type)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <div className="media-card-poster media-card-poster-fallback" aria-hidden="true" />
  }
  return (
    <video
      className="media-card-poster"
      preload="metadata"
      muted
      src={src}
      onError={() => setFailed(true)}
    />
  )
}

function MediaCard({ mission, hidden }: { mission: Mission; hidden: boolean }) {
  const cfg = MISSIONS_CONFIG[mission.type]
  const dm = mission as DebriefMission

  return (
    <button
      type="button"
      className="media-card"
      data-mid={mission.id}
      data-mtype={mission.type}
      hidden={hidden}
      onClick={() => openDebrief(mission.id)}
    >
      <MediaCardPoster type={mission.type} />
      <div className="media-card-type lbl">{cfg.label}</div>
      <div className="media-card-id">{mission.id}</div>
      <div className="media-card-meta">
        <span>{timeHHMM(dm._debriefAt)}</span>
        <span className="state-chip">{String(mission.state).toUpperCase()}</span>
      </div>
      <div className="media-card-analytics">{analyticsSummaryLine(mission)}</div>
    </button>
  )
}

// The props exist only for prop-shape parity with every other
// RightPanel.tsx mode component (see the CONTRACT note above for why
// neither field is read): this panel renders entirely from the store's
// sessionMissions list, which outlives whatever the engine still holds.
export default function MediaPanel(props: MediaPanelProps) {
  void props
  const sessionMissions = useAppStore((s) => s.sessionMissions)
  const [filter, setFilter] = useState<FilterValue>('ALL')

  if (!sessionMissions.length) {
    return (
      <>
        <div className="lbl">Media</div>
        <div className="rp-empty">NO MISSIONS RECORDED YET · CREATE ONE WITH + NEW MISSION</div>
      </>
    )
  }

  const typesPresent = mediaFilterTypes(sessionMissions)

  return (
    <>
      <div className="lbl">
        Media · {sessionMissions.length} mission{sessionMissions.length === 1 ? '' : 's'} this
        session
      </div>
      <div className="media-filters" id="media-filters">
        <button
          type="button"
          className={'fchip' + (filter === 'ALL' ? ' on' : '')}
          data-mtype="ALL"
          onClick={() => setFilter('ALL')}
        >
          ALL
        </button>
        {typesPresent.map((t) => {
          const cfg = MISSIONS_CONFIG[t]
          return (
            <button
              type="button"
              key={t}
              className={'fchip' + (filter === t ? ' on' : '')}
              data-mtype={t}
              onClick={() => setFilter(t)}
            >
              {cfg.label}
            </button>
          )
        })}
      </div>
      <div className="media-grid">
        {sessionMissions.map((m) => (
          <MediaCard key={m.id} mission={m} hidden={filter !== 'ALL' && m.type !== filter} />
        ))}
      </div>
    </>
  )
}
