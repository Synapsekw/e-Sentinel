import { describe, it, expect } from 'vitest'
import { fmtETA, fmtMMSS, thousands, battLevel, padHeading } from './format'

describe('chrome format helpers', () => {
  it('fmtETA renders M:SS with single-digit minutes allowed (panels.js:152-155)', () => {
    expect(fmtETA(0)).toBe('0:00')
    expect(fmtETA(65)).toBe('1:05')
    expect(fmtETA(-5)).toBe('0:00')
    expect(fmtETA(600)).toBe('10:00')
  })
  it('fmtMMSS zero-pads minutes (panels.js:632-637)', () => {
    expect(fmtMMSS(0)).toBe('00:00')
    expect(fmtMMSS(65)).toBe('01:05')
    expect(fmtMMSS(3599)).toBe('59:59')
  })
  it('thousands groups finite numbers and passes anything else through', () => {
    expect(thousands(1234567)).toBe('1,234,567')
    expect(thousands('n/a')).toBe('n/a')
  })
  it('battLevel thresholds match panels.js:401-403', () => {
    expect(battLevel(25)).toBe('red')
    expect(battLevel(26)).toBe('amber')
    expect(battLevel(49)).toBe('amber')
    expect(battLevel(50)).toBe('ok')
  })
  it('padHeading normalises and zero-pads to 3 digits (panels.js:405-407)', () => {
    expect(padHeading(7)).toBe('007')
    expect(padHeading(-90)).toBe('270')
    expect(padHeading(365)).toBe('005')
  })
})
