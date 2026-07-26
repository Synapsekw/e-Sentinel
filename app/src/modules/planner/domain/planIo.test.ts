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

  // Item 3 (planner hardening). Every test below states which PRE-FIX
  // behaviour it catches, established by running each fixture through the
  // pre-fix return path directly. Two distinct failure modes existed:
  //
  //  - THREW: the `[null]` element only. parsePlan's own
  //    `plan.aois.map((aoi) => ({ ...aoi, valid: isValidAoiGeometry(aoi.geometry) }))`
  //    raised "Cannot read properties of null (reading 'geometry')". Swallowed
  //    by loadAutosave's try/catch; an unhandled rejection on IMPORT PLAN.
  //  - ADMITTED: everything else, returned ok:true with no complaint. The
  //    per-case notes record whether the admitted AOI at least ended up
  //    flagged `valid:false`, or -- the worse outcome, and the common one --
  //    was reported as a perfectly good area because @turf/kinks found nothing
  //    to object to in a shape it should never have been shown.
  //
  // Docks had no element handling at ALL pre-fix (parsePlan checked only
  // Array.isArray(p.docks)), so every dock case below is an unconditional
  // silent admission straight through to the map, the inspector and autoPlace.
  describe('Item 3: element-level validation', () => {
    const goodRing = [
      [54.5, 24.2],
      [54.7, 24.2],
      [54.7, 24.4],
      [54.5, 24.4],
      [54.5, 24.2],
    ]
    const goodAoi = (): Record<string, unknown> => ({
      id: 'a1',
      name: 'BOX',
      source: 'drawn',
      valid: true,
      geometry: { type: 'Polygon', coordinates: [goodRing] },
    })
    const goodDock = (): Record<string, unknown> => ({ ...dock })

    // Bypasses addAoi/addDock deliberately: those are typed, and the whole
    // point is a file this build's own APIs could never have produced.
    const planWith = (patch: { aois?: unknown[]; docks?: unknown[] }): string =>
      JSON.stringify({ ...createPlan(), aois: [], docks: [], ...patch })

    const expectRejected = (json: string, fragment: string) => {
      const out = parsePlan(json)
      expect(out.ok).toBe(false)
      if (out.ok) return
      expect(out.message).toContain(fragment)
    }

    it('rejects the literal [null] AOI element instead of throwing out of parsePlan', () => {
      // PRE-FIX: THREW a TypeError inside parsePlan itself. This is the
      // original follow-up. Assert no-throw explicitly -- a plain ok:false
      // assertion would still read as a pass if the throw came back and some
      // future caller wrapped it.
      const json = planWith({ aois: [null] })
      expect(() => parsePlan(json)).not.toThrow()
      expectRejected(json, 'INVALID AREA AT INDEX 0')
    })

    it('rejects a non-object AOI element', () => {
      // PRE-FIX: ADMITTED. Spreading the string produced a char-indexed
      // object with no geometry; isValidAoiGeometry caught kinks' own throw
      // and returned false, so the plan loaded carrying an "area" with no
      // name, no geometry and nothing to draw.
      expectRejected(planWith({ aois: ['nope'] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects an AOI with a blank id', () => {
      // PRE-FIX: ADMITTED as valid:true. A blank id collides with every other
      // blank id as a React key and is invisible to adoptIdsFrom's suffix scan.
      expectRejected(planWith({ aois: [{ ...goodAoi(), id: '   ' }] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects an AOI whose source is outside the drawn|kml|kmz union', () => {
      // PRE-FIX: ADMITTED as valid:true.
      expectRejected(
        planWith({ aois: [{ ...goodAoi(), source: 'wms' }] }),
        'INVALID AREA AT INDEX 0',
      )
    })

    it('rejects an AOI whose geometry declares a type that is not Polygon or MultiPolygon', () => {
      // PRE-FIX: ADMITTED as valid:TRUE -- the worst case here. @turf/kinks
      // accepts LineStrings, so it reported no self-intersection and the AOI
      // was recorded as a good area, then handed to computeCoverage as one.
      const geometry = {
        type: 'LineString',
        coordinates: [
          [54.5, 24.2],
          [54.7, 24.4],
        ],
      }
      expectRejected(planWith({ aois: [{ ...goodAoi(), geometry }] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects an AOI whose coordinates contain a non-number', () => {
      // PRE-FIX: ADMITTED as valid:true. kinks did not notice the string, so
      // the NaN only surfaced much later as an unexplained coverage figure.
      const geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [54.5, 24.2],
            ['x', 24.2],
            [54.7, 24.4],
            [54.5, 24.2],
          ],
        ],
      }
      expectRejected(planWith({ aois: [{ ...goodAoi(), geometry }] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects an AOI with an empty coordinates array', () => {
      // PRE-FIX: ADMITTED as valid:true. There is nothing for kinks to
      // self-intersect in an empty ring list, so a geometry with no ground at
      // all passed the one check that existed. This is why the shape gate
      // rejects empty at every nesting level.
      const geometry = { type: 'Polygon', coordinates: [] }
      expectRejected(planWith({ aois: [{ ...goodAoi(), geometry }] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects a MultiPolygon carrying Polygon-depth coordinates', () => {
      // PRE-FIX: ADMITTED as valid:true. Nesting depth is checked against the
      // DECLARED type, so a type/coordinates mismatch cannot slip past by
      // being well formed for the other type.
      const geometry = { type: 'MultiPolygon', coordinates: [goodRing] }
      expectRejected(planWith({ aois: [{ ...goodAoi(), geometry }] }), 'INVALID AREA AT INDEX 0')
    })

    it('rejects a dock whose position has three elements', () => {
      // PRE-FIX: ADMITTED. PlannedDock.position is typed [lon, lat]; a third
      // element is a file this build cannot have written.
      expectRejected(
        planWith({ docks: [{ ...goodDock(), position: [54.6, 24.3, 120] }] }),
        'INVALID DOCK AT INDEX 0',
      )
    })

    it('rejects a dock whose latitude is out of range', () => {
      // PRE-FIX: ADMITTED. A latitude of 95 is off the globe; it would be
      // placed on the map and fed to turf's buffer regardless.
      expectRejected(
        planWith({ docks: [{ ...goodDock(), position: [54.6, 95] }] }),
        'INVALID DOCK AT INDEX 0',
      )
    })

    it('rejects a dock whose environment is outside the urban|rural union', () => {
      // PRE-FIX: ADMITTED. effectiveRadius branches on `environment ===
      // 'urban'`, so any third value silently took the RURAL range cap --
      // a wrong coverage radius, reported with no indication anything was off.
      expectRejected(
        planWith({ docks: [{ ...goodDock(), environment: 'suburban' }] }),
        'INVALID DOCK AT INDEX 0',
      )
    })

    it('names the offending index rather than always reporting the first element', () => {
      // Guards the loop counter itself: a message hardcoded to INDEX 0 would
      // pass every test above and still be useless on a real file.
      expectRejected(
        planWith({ aois: [goodAoi(), { ...goodAoi(), id: 'a2' }, null] }),
        'INVALID AREA AT INDEX 2',
      )
      expectRejected(
        planWith({ docks: [goodDock(), { ...goodDock(), id: 'd2', source: 'sync' }] }),
        'INVALID DOCK AT INDEX 1',
      )
    })

    it('rejects a dock model that is not in the catalog', () => {
      // Pre-fix: ADMITTED. The spec first recorded catalog-checking as a
      // non-goal, on the premise that the Inspector handles an unknown model.
      // Verified false and reversed: Inspector.tsx does
      // `DOCK_MODELS[dock.dockModel].drones`, a TypeError on an unknown id,
      // so admitting one traded a rejected file for a crashed module.
      expectRejected(
        planWith({ docks: [{ ...goodDock(), dockModel: 'DOCK9' }] }),
        'INVALID DOCK AT INDEX 0',
      )
    })

    it('rejects a drone model that is not in the catalog', () => {
      // Pre-fix: ADMITTED. Same reversal. catalog.ts's effectiveRadius does
      // `DRONES[dock.droneModel].enduranceMin`, which throws on an unknown id
      // before the Inspector even renders.
      expectRejected(
        planWith({ docks: [{ ...goodDock(), droneModel: 'M9X' }] }),
        'INVALID DOCK AT INDEX 0',
      )
    })

    it('still accepts a catalogued but INCOMPATIBLE dock/drone pairing', () => {
      // Load-bearing NON-rejection, and the reason catalog-checking is a
      // membership test rather than a compatibility test. DOCK3 hosts
      // M4TD/M4D and DOCK2 hosts M350, so this pairing is physically
      // impossible -- but both ids exist, so nothing throws, and the value
      // has to survive parsePlan for the Inspector's marked "· INCOMPATIBLE"
      // option and alert badge to have anything to show.
      const out = parsePlan(
        planWith({ docks: [{ ...goodDock(), dockModel: 'DOCK3', droneModel: 'M350' }] }),
      )
      expect(out.ok).toBe(true)
    })

    it('accepts a plan with both arrays populated and round-trips it unchanged', () => {
      const polygonAoi: Aoi = {
        id: 'a1',
        name: 'BOX',
        source: 'kml',
        valid: true,
        simplifiedFrom: 4096,
        geometry: { type: 'Polygon', coordinates: [goodRing] },
      }
      const multiAoi: Aoi = {
        id: 'a2',
        name: 'PAIR',
        source: 'drawn',
        valid: true,
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [55.5, 25.2],
                [55.7, 25.2],
                [55.7, 25.4],
                [55.5, 25.4],
                [55.5, 25.2],
              ],
            ],
            [
              [
                [56.5, 26.2],
                [56.7, 26.2],
                [56.7, 26.4],
                [56.5, 26.4],
                [56.5, 26.2],
              ],
            ],
          ],
        },
      }
      const secondDock: PlannedDock = {
        id: 'd2',
        name: 'D2',
        position: [55.6, 25.3],
        dockModel: 'DOCK2',
        droneModel: 'M350',
        environment: 'rural',
        radiusKmOverride: 7.5,
        source: 'auto',
      }
      const plan = addDock(
        addDock(
          addAoi(addAoi(createPlan({ name: 'ACME', customer: 'ACME CORP' }), polygonAoi), multiAoi),
          dock,
        ),
        secondDock,
      )
      const out = parsePlan(serializePlan(plan))
      if (!out.ok) throw new Error(out.message)
      expect(out.plan).toEqual(plan)
      expect(out.plan.aois).toHaveLength(2)
      expect(out.plan.docks).toHaveLength(2)
    })
  })
})
