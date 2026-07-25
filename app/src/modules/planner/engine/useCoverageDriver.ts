import { useEffect, useRef } from 'react'
import { computeCoverage } from '../domain/coverage'
import { usePlanStore } from '../store/planStore'

export const COVERAGE_DEBOUNCE_MS = 150

// Extracted so the staleness rule is testable without timers or a store.
export function shouldApply(resultRev: number, currentRev: number): boolean {
  return resultRev === currentRev
}

export function useCoverageDriver(): void {
  const plan = usePlanStore((s) => s.plan)
  const revRef = useRef(plan.rev)
  revRef.current = plan.rev

  // Important 8 (final whole-branch review): this effect used to depend on
  // `plan` itself, so it re-ran (and, after COVERAGE_DEBOUNCE_MS, re-ran the
  // full O(n^2) turf pipeline in computeCoverage) on EVERY plan edit,
  // including a plan-name or customer keystroke in PlanTree.tsx that never
  // touches `aois`, `docks` or `params`. Keying the effect off those three
  // fields instead means a cosmetic edit -- which `bump()` (domain/plan.ts)
  // always carries the existing aois/docks/params array/object references
  // through unchanged -- does not schedule a new computation at all.
  // shouldApply/revRef are UNCHANGED: they still compare plain plan.rev
  // numbers, so the staleness guard's own contract (and its existing tests)
  // is untouched. The only difference the dependency change makes to
  // staleness is timing-shaped, not correctness-shaped: this effect now
  // simply runs less often.
  useEffect(() => {
    const rev = plan.rev
    const t = setTimeout(() => {
      const result = computeCoverage(plan)
      if (shouldApply(rev, revRef.current)) {
        usePlanStore.getState().setCoverage(result)
      }
    }, COVERAGE_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.aois, plan.docks, plan.params])
}
