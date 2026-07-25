import { describe, it, expect } from 'vitest'
import { describeSuggestOutcome } from './suggestOutcome'
import type { SuggestResult } from '../domain/autoPlace'
import type { PlannedDock } from '../domain/types'

const dock = (n: number): PlannedDock => ({
  id: `d${n}`,
  name: `PROPOSED ${n}`,
  position: [54.5 + n, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural',
  source: 'auto',
})

const docks = (n: number): PlannedDock[] => Array.from({ length: n }, (_, i) => dock(i))

describe('describeSuggestOutcome', () => {
  it('reports a clean success when the target was reached', () => {
    const r: SuggestResult = {
      docks: docks(11),
      achievedPct: 97.6274561066628,
      stoppedBy: 'target',
    }
    const out = describeSuggestOutcome(r)
    expect(out.text).toBe('LAYOUT: 11 DOCKS · 98% COVERAGE · TARGET MET')
    expect(out.tone).toBe('ok')
  })

  it('uses singular DOCK for exactly one dock', () => {
    const r: SuggestResult = { docks: docks(1), achievedPct: 92, stoppedBy: 'target' }
    expect(describeSuggestOutcome(r).text).toBe('LAYOUT: 1 DOCK · 92% COVERAGE · TARGET MET')
  })

  it('reports a partial outcome (not silence) when the dock cap was hit', () => {
    // This is the exact shape of Defect 2: previously the UI applied the
    // docks and threw away achievedPct/stoppedBy, so a capped, well-short-
    // of-target layout produced no feedback distinguishing it from success.
    const r: SuggestResult = { docks: docks(40), achievedPct: 78, stoppedBy: 'cap' }
    const out = describeSuggestOutcome(r)
    expect(out.text).toBe('STOPPED AT 78% · 40 DOCK CAP')
    expect(out.tone).toBe('alert')
  })

  it('reports a partial outcome when the marginal-gain floor was hit', () => {
    const r: SuggestResult = { docks: docks(11), achievedPct: 99.4, stoppedBy: 'gain' }
    const out = describeSuggestOutcome(r)
    expect(out.text).toBe('STOPPED AT 99% · NEXT DOCK NOT WORTH PLACING')
    expect(out.tone).toBe('alert')
  })

  it('reports a partial outcome when refinement exhausted every site short of target', () => {
    const r: SuggestResult = { docks: docks(6), achievedPct: 61, stoppedBy: 'exhausted' }
    const out = describeSuggestOutcome(r)
    expect(out.text).toBe('STOPPED AT 61% · NO SITES REMAIN')
    expect(out.tone).toBe('alert')
  })

  it('reports failure plainly when nothing could be placed at all', () => {
    const r: SuggestResult = { docks: [], achievedPct: 0, stoppedBy: 'exhausted' }
    const out = describeSuggestOutcome(r)
    expect(out.text).toBe('NO SITES AVAILABLE')
    expect(out.tone).toBe('alert')
  })
})
