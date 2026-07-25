// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:389-399
// (missionLineFor), :422-428 (fpvSources — see the base-path note below),
// :434-435 (FPV_LIVE_STATES / fpvCruising), :517 (renderDronePanel's
// distHomeKm read) and :519-523 (rtbDisabled / holdDisabled /
// controlDisabled's state-array predicates).
//
// Pure (engine is always passed in, never read off a global), matching the
// chrome/dockList.ts pattern from Task 5.

import { MISSIONS_CONFIG, SimRouter, VIDEO_MANIFEST } from '@/modules/console/domain'
import type { Drone, DroneState, Engine } from '@/modules/console/domain'
import { DRONE_STATE_LABELS } from '@/modules/console/chrome/format'

// panels.js:389-399.
export function missionLineFor(engine: Engine | null, drone: Drone): string {
  const stateLbl = DRONE_STATE_LABELS[drone.state] || String(drone.state).toUpperCase()
  const mission = drone.missionId && engine ? engine.missions.get(drone.missionId) : null
  if (mission) {
    const label = MISSIONS_CONFIG[mission.type].label
    const pct = Math.round((mission.progress || 0) * 100)
    return label + ' · ' + pct + '% · ' + stateLbl
  }
  return stateLbl
}

// panels.js:422-428. Legacy served a bare `videos/<file>` relative path;
// this app is served under a base path (see vite's `base` config /
// index.html), so every static asset URL must be prefixed with
// `import.meta.env.BASE_URL` or it 404s once the app isn't hosted at the
// domain root.
export function fpvSources(engine: Engine | null, drone: Drone | null): string[] {
  const mission = drone && drone.missionId && engine ? engine.missions.get(drone.missionId) : null
  if (!mission) return []
  const variants = VIDEO_MANIFEST[mission.type]
  return variants.map((f) => `${import.meta.env.BASE_URL}videos/${f}`)
}

// panels.js:434. The live downlink only runs once the drone is actually
// cruising over the area (transit/on-task and the mid-air states) —
// deliberately NOT during takeoff from the dock or the final landing
// descent, where the frame shows the "acquiring feed" standby instead.
export const FPV_LIVE_STATES: DroneState[] = ['transit', 'on-task', 'rtb', 'hold', 'manual']

export function fpvCruising(drone: Drone | null | undefined): boolean {
  return !!drone && FPV_LIVE_STATES.includes(drone.state)
}

// panels.js:517.
export function distHomeKm(engine: Engine | null, drone: Drone): number {
  const dock = engine ? engine.docks.get(drone.dockId) : null
  if (!dock) return 0
  return SimRouter.distM(drone.pos, dock.coords) / 1000
}

// panels.js:519.
export function rtbDisabled(drone: Drone): boolean {
  return !['transit', 'on-task', 'hold'].includes(drone.state)
}

// panels.js:520-521.
export function holdDisabled(drone: Drone): boolean {
  const isHeld = drone.state === 'hold'
  return !isHeld && !['transit', 'on-task'].includes(drone.state)
}

// panels.js:522-523. Exported for interface completeness / future Phase 1E
// use — DronePanel.tsx currently disables #rp-control unconditionally (see
// its header comment), so this predicate isn't consumed there yet.
export function controlDisabled(drone: Drone): boolean {
  const isManual = drone.state === 'manual'
  return !isManual && !['transit', 'on-task', 'hold'].includes(drone.state)
}
