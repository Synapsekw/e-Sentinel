// Turns a SuggestResult (returned by domain/autoPlace's suggestLayout) into
// the short, uppercase mono status line the planner UI shows after SUGGEST
// LAYOUT runs. Before this existed, the UI applied `result.docks` and threw
// away `achievedPct`/`stoppedBy` entirely -- a user drawing a large AOI and
// clicking SUGGEST LAYOUT got zero docks and *no feedback at all*, not even
// once Defect 1 (the marginal-gain floor) was fixed to genuinely place
// partial layouts instead of returning nothing. The whole point of the
// honest `stoppedBy` labelling in autoPlace.ts is defeated if nothing ever
// surfaces it -- see the design doc section 8's `stoppedBy` table.
//
// This is UI-only formatting logic (not domain/), so it lives here rather
// than in domain/autoPlace.ts, which must stay framework-free.
import type { SuggestResult } from '../domain/autoPlace'

export type SuggestOutcomeTone = 'ok' | 'alert'

export interface SuggestOutcome {
  text: string
  tone: SuggestOutcomeTone
}

export function describeSuggestOutcome(result: SuggestResult): SuggestOutcome {
  const pct = Math.round(result.achievedPct)

  if (result.docks.length === 0) {
    // Genuinely nothing could be placed -- a real failure, not silence.
    return { text: 'NO SITES AVAILABLE', tone: 'alert' }
  }

  if (result.stoppedBy === 'target') {
    return {
      text: `LAYOUT: ${result.docks.length} DOCK${result.docks.length === 1 ? '' : 'S'} · ${pct}% COVERAGE · TARGET MET`,
      tone: 'ok',
    }
  }

  if (result.stoppedBy === 'cap') {
    // Capped before reaching the target: a genuine shortfall.
    return { text: `STOPPED AT ${pct}% · ${result.docks.length} DOCK CAP`, tone: 'alert' }
  }

  if (result.stoppedBy === 'gain') {
    // Candidates remained, but the best of them was not worth placing --
    // still a shortfall relative to the target if we got here at all
    // (reaching 'target' returns above before this branch is reached).
    return { text: `STOPPED AT ${pct}% · NEXT DOCK NOT WORTH PLACING`, tone: 'alert' }
  }

  // 'exhausted' with docks placed: densification ran out of sites before
  // reaching target, having already placed what it could.
  return { text: `STOPPED AT ${pct}% · NO SITES REMAIN`, tone: 'alert' }
}

// Critical 2 (final whole-branch review): ui/Planner.tsx used to set
// layoutStatus once, after a SUGGEST LAYOUT run, and never clear it. Delete
// a dock afterward and the strip kept showing the stale layout message
// ("LAYOUT: 4 DOCKS · 96% COVERAGE · TARGET MET") right next to the live,
// now-contradictory coverage stats. A layout message only describes the
// plan revision it was computed for; once the plan moves on to a different
// revision, it must stop describing anything at all. This is the same
// staleness shape useCoverageDriver.ts's shouldApply already solves for
// computeCoverage's own debounced result, extracted here as a plain
// predicate (rather than folded inline into ui/Planner.tsx) so it can be
// pinned by a test without mounting the full component tree -- this module
// already exists precisely to keep this kind of UI-only formatting/staleness
// logic out of domain/, which must stay framework-free.
export function isLayoutStatusCurrent(statusRev: number, planRev: number): boolean {
  return statusRev === planRev
}
