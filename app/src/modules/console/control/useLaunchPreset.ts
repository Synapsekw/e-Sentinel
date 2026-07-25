// Ported (Phase 1E / Task 4) from assets/js/ui/control.js:748-770
// (control.launchPreset). Fires a preset the same way the wizard's LAUNCH
// does: mark it a user mission (so its debrief -- and Higgsfield video --
// auto-opens on completion), follow the drone, and pan to the launching
// dock so the operator sees it go.

import { useOptionalEngine, useOptionalMap } from '@/modules/console/panels/hooks'
import { selectEntity } from '@/modules/console/selection'
import { useAppStore } from '@/shared/store'
import { nowClockStr } from '@/modules/console/chrome/format'
import type { Mission, MissionType } from '@/modules/console/domain'
import { PRESET_NEAR } from './presets'

export function useLaunchPreset(): { launchPreset: (type: MissionType) => Mission | null } {
  const engine = useOptionalEngine()
  const map = useOptionalMap()

  function launchPreset(type: MissionType): Mission | null {
    // control.js:753: `control.mode !== 'normal' || !window.__engine ||
    // !window.__engine.launchPreset` -- launchPreset is a required member
    // of this port's Engine interface, so only the mode/engine checks apply.
    if (useAppStore.getState().controlMode !== 'normal' || !engine) return null

    const near = PRESET_NEAR[type]
    let mission: Mission
    try {
      mission = engine.launchPreset(type, near ? { near } : {})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useAppStore.getState().pushTickerEvent({
        time: nowClockStr(),
        source: 'SENTINEL',
        message: 'MISSION LAUNCH FAILED · ' + message,
        level: 'warn',
        droneId: null,
      })
      return null
    }

    useAppStore.getState().addUserMission(mission.id)
    const droneId = 'D-' + mission.dockId
    useAppStore.getState().setFollowDroneId(droneId)
    selectEntity({ type: 'drone', id: droneId }, engine, map ?? null)
    const dock = engine.docks.get(mission.dockId)
    if (dock && map) map.flyTo({ center: dock.coords, zoom: 12.2 })
    return mission
  }

  return { launchPreset }
}
