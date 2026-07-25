import { describe, it, expect } from 'vitest'
import { describeSuggestOutcome, isLayoutStatusCurrent } from './suggestOutcome'
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

describe('isLayoutStatusCurrent (Critical 2)', () => {
  it('is current while the plan is still at the revision the layout was computed for', () => {
    expect(isLayoutStatusCurrent(4, 4)).toBe(true)
  })

  it('is stale once the plan has moved on to a later revision', () => {
    // The exact regression this closes: delete a dock (or make any other
    // edit) after SUGGEST LAYOUT runs, and the plan's rev advances past the
    // one the layout message described -- the message must disappear rather
    // than sit next to now-contradictory live coverage stats.
    expect(isLayoutStatusCurrent(4, 5)).toBe(false)
  })

  it('is also stale for a revision that is somehow behind the layout status (defensive symmetry)', () => {
    expect(isLayoutStatusCurrent(5, 4)).toBe(false)
  })
})
