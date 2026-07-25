// Ported (Phase 1E / Task 5) from assets/js/ui/panels.js:1085-1097
// (openDebrief), :1099-1122 (recordCompletedMission + SESSION_MISSIONS_CAP)
// and :1124-1138 (wireDebriefWatch).
//
// wireDebriefWatch polled for `window.__engine` becoming available (the
// engine didn't exist until the first console dive-in) and then subscribed
// exactly once. This port instead reads the engine off EngineContext via
// useOptionalEngine() — EngineProvider (Phase 1C) already makes that a
// page-lifetime singleton — and the effect below re-subscribes whenever the
// engine identity changes (in practice: once, the first time it becomes
// non-null after boot).
//
// MOUNT POINT: call this once from Console.tsx (Phase 1E / Task 8 already
// specifies this — "Console.tsx ... calls useManualControl, useWizard,
// useCaptureMapClicks, useCaptureKeys, useMapTrackInteractions,
// useDebriefWatch, and registerCaptureExits"). Console.tsx is a descendant
// of the page-level <EngineProvider> (see App.tsx), so useOptionalEngine()
// resolves there. One consequence worth flagging: unlike
// engine/attachTickerPush.ts (subscribed directly inside EngineProvider
// itself, so it keeps accumulating ticker events even off the /console
// route), Console.tsx unmounts on navigation — a mission that completes
// while the operator is elsewhere in the app won't be recorded until they
// return to /console and this hook resubscribes. Giving this hook the same
// off-route reach as the ticker push would mean restructuring
// EngineProvider.tsx (a component nested inside its own
// <EngineContext.Provider>, so a context-consuming hook there could
// resolve the engine) — EngineProvider.tsx is outside this task's file
// scope, so that restructuring is left for whoever picks it up next.

import { useEffect } from 'react'
import type { Mission } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { nowClockStr } from '@/modules/console/chrome/format'
import { useOptionalEngine } from './hooks'
import { computeVideoVariant } from './debriefModel'
import type { DebriefMission } from './debriefModel'

// panels.js:1125. Anchored end-to-end so a coincidental "...COMPLETE"
// substring elsewhere in a message can't false-positive — in particular the
// 'N% COMPLETE' progress-milestone events the engine also emits mid-mission
// (engine.ts:587) never match, since they have trailing text after the
// mission id that this regex doesn't allow.
const COMPLETE_RE = /^MISSION (\S+) COMPLETE$/

// panels.js:1099-1118. Not exported: this hook is the only caller, and it
// needs store + ticker access it wouldn't have from debriefModel.ts's pure
// module.
function recordCompletedMission(mission: Mission): void {
  const dm = mission as DebriefMission
  if (dm._debriefAt) return // already recorded (defensive; engine only emits COMPLETE once per mission)
  dm._debriefAt = new Date()

  const {
    sessionMissions,
    userMissions,
    pushSessionMission,
    pushTickerEvent,
    setSelection,
    setRightPanel,
  } = useAppStore.getState()

  const priorOfType = sessionMissions.filter((m) => m.type === mission.type).length
  dm._videoVariant = computeVideoVariant(mission.type, priorOfType)

  pushSessionMission(mission)

  // panels.js:1109-1114. TickerEvent (shared/store.ts) carries no `onClick`
  // field the way legacy's pushEvent did, so the chip's copy/level/source
  // are transcribed exactly but the click-through to openDebrief() is not
  // wired here — that would require extending hud/Ticker.tsx's rendering,
  // which is outside this task's file scope (not one of the seven files
  // listed in this task's header comment set).
  pushTickerEvent({
    time: nowClockStr(),
    source: mission.dockId,
    level: 'info',
    message: 'DEBRIEF READY · ' + mission.id,
    droneId: null,
  })

  // panels.js:1116-1117: auto-open only for missions the operator
  // themselves launched (userMissions) — scheduler-spawned auto missions
  // still land in the session list (Task 6's MEDIA) without stealing the
  // panel from whatever the operator is looking at.
  //
  // openDebrief (panels.js:1085-1091) also stands down manual control and
  // the mission wizard first (EC2.control.exitManual()/exitWizard()) before
  // swapping the panel. That handoff belongs to Tasks 2/3's hooks
  // (control/useManualControl.ts, control/useWizard.ts) and this file
  // cannot reach them without leaving Task 5's scope — Console.tsx (Task 8)
  // is the one place all of those are already wired together, so a mission
  // auto-opening its debrief while manual control or the wizard happens to
  // be engaged on a *different* drone/mission is a gap this hook alone
  // cannot close.
  if (userMissions.includes(mission.id)) {
    setSelection(null)
    setRightPanel({ mode: 'debrief', id: mission.id })
  }
}

export default function useDebriefWatch(): void {
  const engine = useOptionalEngine()

  useEffect(() => {
    if (!engine) return
    const cb = engine.onEvent((ev) => {
      const match = COMPLETE_RE.exec(ev.message)
      if (!match) return
      const mission = engine.missions.get(match[1])
      if (mission) recordCompletedMission(mission)
    })
    return () => engine.offEvent(cb)
  }, [engine])
}
