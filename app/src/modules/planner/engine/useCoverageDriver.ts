import { useEffect } from 'react'
import { computeCoverage } from '../domain/coverage'
import { usePlanStore } from '../store/planStore'

export const COVERAGE_DEBOUNCE_MS = 150

// Extracted so the staleness rule is testable without timers or a store.
export function shouldApply(resultRev: number, currentRev: number): boolean {
  return resultRev === currentRev
}

export function useCoverageDriver(): void {
  const plan = usePlanStore((s) => s.plan)

  // Important 8 (final whole-branch review, since re-broken and re-fixed by
  // Important 1 -- see below) keys this effect's scheduling off
  // aois/docks/params rather than `plan` itself, so a cosmetic-only edit --
  // which domain/plan.ts's bump() always carries the existing aois/docks/
  // params array/object references through unchanged -- does not
  // reschedule a new computation at all.
  //
  // Important 1 (final whole-branch review): that dependency change broke
  // the staleness guard, because the timer body used to capture `const rev
  // = plan.rev` from THIS render's closure at schedule time and compare it
  // against a `revRef` reassigned on every render. A cosmetic edit within
  // the debounce window bumps `plan.rev` (and so `revRef.current`) WITHOUT
  // rescheduling the timer (its deps are unchanged), so when the timer
  // fired it computed coverage from the stale pre-cosmetic-edit `plan`
  // closure, then compared that stale rev against the now-newer revRef and
  // (correctly, per the guard's own contract) discarded it -- but nothing
  // was left to schedule another run, so the discarded result was gone for
  // good and the strip kept showing pre-edit coverage indefinitely.
  //
  // The fix: never compute from a value closed over at schedule time. Read
  // the plan LIVE, inside the timeout, and derive both the coverage and the
  // revision the guard checks from that exact same snapshot -- the two
  // values the guard compares can then never come from different renders.
  // A snapshot that is itself superseded by the time computeCoverage
  // returns (simulated in the test with a synchronous store update inside
  // the mocked computeCoverage) is still caught: the guard re-reads
  // getState().plan.rev AFTER the computation, not before.
  useEffect(() => {
    const t = setTimeout(() => {
      const snapshot = usePlanStore.getState().plan
      const result = computeCoverage(snapshot)
      if (shouldApply(snapshot.rev, usePlanStore.getState().plan.rev)) {
        usePlanStore.getState().setCoverage(result)
      }
    }, COVERAGE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plan.aois, plan.docks, plan.params])
}
