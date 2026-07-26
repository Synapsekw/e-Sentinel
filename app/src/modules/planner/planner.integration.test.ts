// @vitest-environment jsdom
//
// This is the only test in the planner module that exercises every pure
// layer back to back, in the order the UI actually drives them: import a
// KML -> auto-place docks over the resulting AOI -> compute coverage on the
// resulting plan -> round-trip the whole plan through JSON. Each layer has
// its own focused unit tests elsewhere (kml.test.ts, autoPlace.test.ts,
// coverage.test.ts, planIo.test.ts); this one exists to catch a composition
// break that none of those would catch alone -- e.g. a field rename in
// CoverageResult that both computeCoverage and its own test agree on, but
// that the plan produced by suggestLayout doesn't actually satisfy, or a
// round-trip that silently drops the docks suggestLayout placed.
//
// @vitest-environment jsdom is required because parseKmlText uses
// `new DOMParser()` internally; the repo's default vitest environment is
// 'node' (see app/vite.config.ts), which has no DOMParser global.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createPlan,
  addAoi,
  setDocks,
  resetIdsForTest,
  setNowForTest,
  resetNowForTest,
} from './domain/plan'
import { suggestLayout } from './domain/autoPlace'
import { computeCoverage } from './domain/coverage'
import { parseKmlText } from './io/kml'
import { serializePlan, parsePlan } from './domain/planIo'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Routed through a variable rather than the literal
// `new URL('./io/fixtures/simple.kml', import.meta.url)` pattern: under the
// jsdom test environment, Vite's import-analysis plugin treats that exact
// shape as a browser asset reference and rewrites import.meta.url to
// `self.location` (an http: URL), which then breaks fileURLToPath. See the
// identical note in io/kml.test.ts.
const testFileUrl = import.meta.url
const fixture = readFileSync(
  fileURLToPath(new URL('./io/fixtures/simple.kml', testFileUrl)),
  'utf8',
)

describe('planner end to end (pure layers)', () => {
  beforeEach(() => {
    resetIdsForTest()
    setNowForTest(() => '2026-01-01T00:00:00.000Z')
  })

  afterEach(() => {
    resetNowForTest()
    resetIdsForTest()
  })

  it('imports a KML, auto-places docks, reaches coverage and round-trips the plan', () => {
    const imported = parseKmlText(fixture)
    if (!imported.ok) throw new Error(imported.code)
    // The fixture holds one Polygon placemark and one Point placemark (see
    // io/fixtures/simple.kml); a stage that silently dropped the polygon
    // would still leave `imported.ok` true with an empty aois array, so
    // assert the actual content, not just the ok flag.
    expect(imported.aois).toHaveLength(1)
    expect(imported.skipped).toBe(1)
    expect(imported.aois[0].valid).toBe(true)

    let plan = createPlan({ name: 'ACME', customer: 'ACME CORP' })
    for (const aoi of imported.aois) plan = addAoi(plan, aoi)
    expect(plan.aois).toHaveLength(1)

    const suggestion = suggestLayout(plan)
    // A composition break upstream (e.g. the imported AOI silently marked
    // invalid, or geometry mangled in a way suggestLayout's own AOI filter
    // rejects) would show up here as an empty dock set even though
    // `imported.ok` was true -- this is the assertion that actually proves
    // the KML -> AOI -> placement handoff works, not just that each stage
    // ran without throwing.
    expect(suggestion.docks.length).toBeGreaterThan(0)
    expect(suggestion.docks.every((d) => d.source === 'auto')).toBe(true)
    // 'exhausted' would mean the placement loop never got started at all;
    // ruling it out here is a cheap extra check that this AOI genuinely fed
    // the placement algorithm real, non-degenerate geometry.
    expect(suggestion.stoppedBy).not.toBe('exhausted')

    plan = setDocks(plan, suggestion.docks)
    expect(plan.docks).toHaveLength(suggestion.docks.length)

    const coverage = computeCoverage(plan)
    if (!coverage.ok) throw new Error('expected coverage')
    // Bare "ok: true" would also pass for a near-zero coverage figure on an
    // empty dock set; require both a real percentage AND per-dock detail
    // that lines up with the docks actually placed, so a stage that
    // silently returned degenerate/empty results would fail this test.
    expect(coverage.coveragePct).toBeGreaterThan(80)
    expect(coverage.aoiKm2).toBeGreaterThan(0)
    expect(coverage.perDock).toHaveLength(suggestion.docks.length)
    expect(coverage.perDock.every((d) => d.grossContributionKm2 > 0)).toBe(true)
    // achievedPct from suggestLayout is computed via its own internal
    // computeCoverage call over the same docks; pinning them together
    // catches a divergence between what suggestLayout reports and what a
    // fresh computeCoverage call over the resulting plan actually finds.
    expect(coverage.coveragePct).toBeCloseTo(suggestion.achievedPct, 6)

    const restored = parsePlan(serializePlan(plan))
    if (!restored.ok) throw new Error(restored.message)
    // Length checks alone would pass for docks/AOIs that round-tripped with
    // corrupted fields (wrong position, wrong model); assert full deep
    // equality against the pre-serialize plan so any field silently dropped
    // or reshaped by the JSON round trip fails this test.
    expect(restored.plan.docks).toHaveLength(suggestion.docks.length)
    expect(restored.plan.aois).toHaveLength(1)
    expect(restored.plan.docks).toEqual(plan.docks)
    expect(restored.plan.aois).toEqual(plan.aois)
    expect(restored.plan).toEqual(plan)
  })
})
