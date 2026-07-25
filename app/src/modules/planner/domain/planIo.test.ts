import { describe, it, expect } from 'vitest'
import { serializePlan, parsePlan } from './planIo'
import { createPlan, addDock } from './plan'
import type { PlannedDock } from './types'

const dock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
}

describe('plan JSON round-trip', () => {
  it('survives serialize then parse unchanged', () => {
    const plan = addDock(createPlan({ name: 'ACME', customer: 'ACME CORP' }), dock)
    const out = parsePlan(serializePlan(plan))
    if (!out.ok) throw new Error(out.message)
    expect(out.plan).toEqual(plan)
  })

  it('rejects JSON that is not a plan', () => {
    const out = parsePlan('{"hello":true}')
    expect(out.ok).toBe(false)
  })

  it('rejects a future schema version', () => {
    const plan = { ...createPlan(), schemaVersion: 99 }
    const out = parsePlan(JSON.stringify(plan))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('99')
  })

  it('rejects malformed JSON without throwing', () => {
    expect(() => parsePlan('{not json')).not.toThrow()
    expect(parsePlan('{not json').ok).toBe(false)
  })

  describe('Finding 3: params and string-field validation', () => {
    it('rejects a plan missing params entirely, instead of admitting one PlanTree.tsx would crash on', () => {
      // Before this fix, a plan shaped exactly like this would parse ok, then
      // whitescreen the whole SPA the moment PlanTree.tsx read
      // plan.params.targetOverlapPct during render.
      const withoutParams: Record<string, unknown> = { ...createPlan() }
      delete withoutParams.params
      const out = parsePlan(JSON.stringify(withoutParams))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('PARAMETERS')
    })

    it("rejects a targetOverlapPct of 100 (the value that would hang autoPlace.ts's lattice loop)", () => {
      const plan = { ...createPlan(), params: { targetOverlapPct: 100, requiredCoveragePct: 95 } }
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('TARGET OVERLAP')
    })

    it('rejects a targetOverlapPct above 80 (the slider maximum)', () => {
      const plan = { ...createPlan(), params: { targetOverlapPct: 81, requiredCoveragePct: 95 } }
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('TARGET OVERLAP')
    })

    it('rejects a requiredCoveragePct below 50 (the slider minimum)', () => {
      const plan = { ...createPlan(), params: { targetOverlapPct: 20, requiredCoveragePct: 10 } }
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('REQUIRED COVERAGE')
    })

    it('accepts the boundary values the sliders themselves can produce', () => {
      const plan = { ...createPlan(), params: { targetOverlapPct: 0, requiredCoveragePct: 50 } }
      expect(parsePlan(JSON.stringify(plan)).ok).toBe(true)
      const plan2 = { ...createPlan(), params: { targetOverlapPct: 80, requiredCoveragePct: 100 } }
      expect(parsePlan(JSON.stringify(plan2)).ok).toBe(true)
    })

    it('rejects a plan whose customer field is not a string', () => {
      const plan = { ...createPlan(), customer: 42 }
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('customer')
    })

    it('rejects a plan whose rev field is missing', () => {
      const withoutRev: Record<string, unknown> = { ...createPlan() }
      delete withoutRev.rev
      const out = parsePlan(JSON.stringify(withoutRev))
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain('rev')
    })
  })
})
