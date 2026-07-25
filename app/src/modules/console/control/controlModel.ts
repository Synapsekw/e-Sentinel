// Ported (Phase 1E / Task 1) from assets/js/ui/control.js:56-84
// (updateNewMissionButtonState) — pure predicates only. Legacy read/wrote
// `control.mode` and the button elements' `.disabled`/`.title` directly in
// one function; here the mode -> button-state mapping is a pure function
// consumed by chrome/Topbar.tsx's ordinary prop-driven rendering, and
// isCaptureMode backs selection/selectEntity.ts's inCaptureMode()
// (control.js:2636-2638's inCaptureMode, panels.js).

import type { ControlMode } from '@/shared/store'

// panels.js:2636-2638 (inCaptureMode): true whenever a capture mode
// (manual control or the mission wizard) holds the map/right panel
// exclusively.
export function isCaptureMode(mode: ControlMode): boolean {
  return mode !== 'normal'
}

export interface ButtonState {
  disabled: boolean
  title: string
}

// control.js:56-69 — the '+ NEW MISSION' button (#btn-newmission) half of
// updateNewMissionButtonState.
export function newMissionButtonState(mode: ControlMode): ButtonState {
  if (mode === 'manual') return { disabled: true, title: 'UNAVAILABLE DURING MANUAL CONTROL' }
  if (mode === 'wizard') return { disabled: true, title: 'MISSION WIZARD ACTIVE' }
  return { disabled: false, title: 'CREATE A NEW MISSION' }
}

// control.js:73-83 — the MISSIONS button (#btn-missions) half of
// updateNewMissionButtonState.
export function missionsButtonState(mode: ControlMode): ButtonState {
  if (mode !== 'normal') {
    return {
      disabled: true,
      title: mode === 'manual' ? 'UNAVAILABLE DURING MANUAL CONTROL' : 'MISSION WIZARD ACTIVE',
    }
  }
  return { disabled: false, title: 'LAUNCH A PREDEFINED MISSION' }
}
