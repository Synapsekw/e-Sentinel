import { describe, it, expect } from 'vitest'
import { serializePlan, parsePlan } from './planIo'
import { createPlan, addDock, addAoi } from './plan'
import type { Aoi, PlannedDock } from './types'

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

  describe('Minor 4: AOI validity is re-derived, not trusted verbatim', () => {
    // A self-intersecting bowtie ring. isValidAoiGeometry (domain/geometry.ts)
    // flags this via @turf/kinks; the file below claims `valid: true` for it
    // anyway, simulating a plan autosaved (or hand-edited/exported) by a
    // pre-Important-4 build that never ran that check at all.
    const selfIntersectingAoi = (): Aoi => ({
      id: 'a1',
      name: 'BOWTIE',
      source: 'drawn',
      valid: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [54.5, 24.2],
            [54.7, 24.4],
            [54.7, 24.2],
            [54.5, 24.4],
            [54.5, 24.2],
          ],
        ],
      },
    })

    it('flips a self-intersecting AOI to invalid even though the file claims valid: true', () => {
      // This matters concretely: without re-deriving it here, this exact
      // shape reaches computeCoverage as valid: true and collapses the
      // WHOLE plan's coverage result to `{ ok: false, reason: 'degenerate' }`
      // (see domain/geometry.ts's module comment) -- both loadAutosave() and
      // the IMPORT PLAN handler in ui/Planner.tsx call parsePlan and nothing
      // else re-checks this, so the fix has to live here to cover both.
      const plan = addAoi(createPlan(), selfIntersectingAoi())
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.plan.aois[0].valid).toBe(false)
    })

    it('leaves a genuinely valid AOI valid after re-derivation', () => {
      const validAoi: Aoi = {
        id: 'a1',
        name: 'BOX',
        source: 'drawn',
        valid: true,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [54.5, 24.2],
              [54.7, 24.2],
              [54.7, 24.4],
              [54.5, 24.4],
              [54.5, 24.2],
            ],
          ],
        },
      }
      const plan = addAoi(createPlan(), validAoi)
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.plan.aois[0].valid).toBe(true)
    })

    it('corrects a mislabeled AOI the other direction too: a genuinely valid ring marked valid: false in the file is not left stuck invalid', () => {
      // Re-derivation is not one-directional -- it recomputes from the
      // actual geometry regardless of what the file claimed either way.
      const mislabeled: Aoi = {
        id: 'a1',
        name: 'BOX',
        source: 'drawn',
        valid: false,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [54.5, 24.2],
              [54.7, 24.2],
              [54.7, 24.4],
              [54.5, 24.4],
              [54.5, 24.2],
            ],
          ],
        },
      }
      const plan = addAoi(createPlan(), mislabeled)
      const out = parsePlan(JSON.stringify(plan))
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.plan.aois[0].valid).toBe(true)
    })
  })
})
