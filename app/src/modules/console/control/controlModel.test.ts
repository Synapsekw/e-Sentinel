import { describe, it, expect } from 'vitest'
import { isCaptureMode, newMissionButtonState, missionsButtonState } from './controlModel'

describe('control model', () => {
  it('isCaptureMode is true for manual and wizard only', () => {
    expect(isCaptureMode('normal')).toBe(false)
    expect(isCaptureMode('manual')).toBe(true)
    expect(isCaptureMode('wizard')).toBe(true)
  })
  it('NEW MISSION button state matches control.js:56-69', () => {
    expect(newMissionButtonState('normal')).toEqual({
      disabled: false,
      title: 'CREATE A NEW MISSION',
    })
    expect(newMissionButtonState('manual')).toEqual({
      disabled: true,
      title: 'UNAVAILABLE DURING MANUAL CONTROL',
    })
    expect(newMissionButtonState('wizard')).toEqual({
      disabled: true,
      title: 'MISSION WIZARD ACTIVE',
    })
  })
  it('MISSIONS button state matches control.js:73-83', () => {
    expect(missionsButtonState('normal')).toEqual({
      disabled: false,
      title: 'LAUNCH A PREDEFINED MISSION',
    })
    expect(missionsButtonState('manual')).toEqual({
      disabled: true,
      title: 'UNAVAILABLE DURING MANUAL CONTROL',
    })
    expect(missionsButtonState('wizard')).toEqual({
      disabled: true,
      title: 'MISSION WIZARD ACTIVE',
    })
  })
})
