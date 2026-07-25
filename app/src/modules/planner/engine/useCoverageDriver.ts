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

  useEffect(() => {
    const rev = plan.rev
    const t = setTimeout(() => {
      const result = computeCoverage(plan)
      if (shouldApply(rev, revRef.current)) {
        usePlanStore.getState().setCoverage(result)
      }
    }, COVERAGE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plan])
}
