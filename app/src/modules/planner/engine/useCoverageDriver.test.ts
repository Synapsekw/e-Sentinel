// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { shouldApply, COVERAGE_DEBOUNCE_MS, useCoverageDriver } from './useCoverageDriver'
import { usePlanStore } from '../store/planStore'
import { computeCoverage } from '../domain/coverage'
import type { DeploymentPlan, CoverageResult } from '../domain/types'

// The hook imports computeCoverage by name, so mocking the module and
// asserting on the mock's call count is how we observe "did the expensive
// turf pipeline run" without actually running turf.
vi.mock('../domain/coverage', () => ({
  computeCoverage: vi.fn(),
}))

const mockComputeCoverage = vi.mocked(computeCoverage)

const BASE_PLAN: Omit<DeploymentPlan, 'rev'> = {
  id: 'plan-test',
  name: 'Test Plan',
  customer: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  schemaVersion: 1,
  aois: [],
  docks: [],
  params: { targetOverlapPct: 20, requiredCoveragePct: 95 },
}

// Fresh aois/docks/params references on every call, not just a fresh `rev`
// -- matching what a real edit through domain/plan.ts's bump() always does
// (a genuine geometry change always produces a new array/object reference
// for whichever field changed). Important 8's fix keys useCoverageDriver's
// effect off exactly these three references instead of plan identity, so a
// makePlan fixture that reused BASE_PLAN's aois/docks/params across every
// call (as an earlier revision of this file did) would make the effect
// think nothing ever changed across this whole suite's rev bumps -- see
// the "does not recompute when only cosmetic fields change" test below for
// the case that fixture gap would otherwise mask.
function makePlan(rev: number): DeploymentPlan {
  return {
    ...BASE_PLAN,
    aois: [...BASE_PLAN.aois],
    docks: [...BASE_PLAN.docks],
    params: { ...BASE_PLAN.params },
    rev,
  }
}

const NO_AOI_RESULT: CoverageResult = { ok: false, reason: 'no-aoi' }

// Captured once, before any test spies on a store action, so beforeEach can
// restore the pristine (unspied) action references every run.
const pristineStoreState = usePlanStore.getState()

describe('shouldApply', () => {
  it('applies a result computed from the current revision', () => {
    expect(shouldApply(7, 7)).toBe(true)
  })

  it('discards a result whose plan revision is already stale', () => {
    // The plan changed while the computation was in flight. Writing this
    // result would show numbers for a plan that no longer exists.
    expect(shouldApply(6, 7)).toBe(false)
  })

  it('debounces at 150ms', () => {
    // This pins the constant; it does not by itself prove the hook debounces.
    // The tests below drive the hook with fake timers to prove the behavior.
    expect(COVERAGE_DEBOUNCE_MS).toBe(150)
  })
})

describe('useCoverageDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockComputeCoverage.mockReset()
    mockComputeCoverage.mockReturnValue(NO_AOI_RESULT)
    usePlanStore.setState({
      ...pristineStoreState,
      plan: makePlan(0),
      coverage: NO_AOI_RESULT,
      selection: null,
    })
  })

  afterEach(() => {
    // vite.config.ts now sets test.globals: true, so @testing-library/react's
    // auto-cleanup (which hooks a global afterEach) DOES register. This
    // explicit cleanup() is kept anyway: it is idempotent, and it keeps this
    // file correct on its own terms rather than depending on a config flag
    // holding still. Without either, a renderHook instance from one test
    // stays mounted and subscribed to usePlanStore, so it keeps reacting to
    // store updates made by later tests.
    cleanup()
    vi.useRealTimers()
  })

  it('coalesces rapid successive edits into a single computeCoverage call', () => {
    // Three edits fired faster than the 150ms debounce window. If the
    // effect's `return () => clearTimeout(t)` were ever dropped, each edit
    // would leave its own live timer behind and all of them would fire.
    renderHook(() => useCoverageDriver())

    act(() => {
      usePlanStore.setState({ plan: makePlan(1) })
    })
    act(() => {
      vi.advanceTimersByTime(50)
    })
    act(() => {
      usePlanStore.setState({ plan: makePlan(2) })
    })
    act(() => {
      vi.advanceTimersByTime(50)
    })
    act(() => {
      usePlanStore.setState({ plan: makePlan(3) })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(mockComputeCoverage).toHaveBeenCalledTimes(1)
  })

  it('computes after the debounce elapses for a single edit, and writes the result', () => {
    const result: CoverageResult = { ok: false, reason: 'no-docks' }
    mockComputeCoverage.mockReturnValue(result)
    const setCoverageSpy = vi.spyOn(usePlanStore.getState(), 'setCoverage')

    renderHook(() => useCoverageDriver())

    act(() => {
      usePlanStore.setState({ plan: makePlan(1) })
    })

    // Nothing should happen before the debounce window elapses.
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS - 1)
    })
    expect(mockComputeCoverage).not.toHaveBeenCalled()
    expect(setCoverageSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(mockComputeCoverage).toHaveBeenCalledTimes(1)
    expect(setCoverageSpy).toHaveBeenCalledWith(result)
  })

  it('cancels an in-flight timeout on unmount: nothing computes or writes afterward', () => {
    const setCoverageSpy = vi.spyOn(usePlanStore.getState(), 'setCoverage')
    const { unmount } = renderHook(() => useCoverageDriver())

    act(() => {
      usePlanStore.setState({ plan: makePlan(1) })
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(mockComputeCoverage).not.toHaveBeenCalled()
    expect(setCoverageSpy).not.toHaveBeenCalled()
  })

  it('discards a result computed against a plan revision that has since gone stale', () => {
    // computeCoverage is what the 150ms debounce exists to throttle, so in
    // production it can genuinely still be running when a fresh edit lands.
    // Simulate exactly that: while "computing" for rev 1, the plan advances
    // to rev 2 before the call returns. This is not mocking the guard itself
    // (shouldApply / revRef are untouched) -- it is manufacturing the one
    // real-world race the guard exists for.
    const staleResult: CoverageResult = { ok: false, reason: 'degenerate' }
    const setCoverageSpy = vi.spyOn(usePlanStore.getState(), 'setCoverage')

    mockComputeCoverage.mockImplementation((plan: DeploymentPlan) => {
      if (plan.rev === 1) {
        // flushSync forces React to re-render synchronously here, so
        // revRef.current picks up rev 2 before this call returns and the
        // hook's shouldApply(rev, revRef.current) check runs against it --
        // otherwise React defers the re-render until the act() this all
        // runs inside of has finished, too late to affect the check below.
        flushSync(() => {
          usePlanStore.setState({ plan: makePlan(2) })
        })
      }
      return staleResult
    })

    renderHook(() => useCoverageDriver())

    act(() => {
      usePlanStore.setState({ plan: makePlan(1) })
    })

    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(mockComputeCoverage).toHaveBeenCalledTimes(1)
    expect(setCoverageSpy).not.toHaveBeenCalled()
  })

  it('does not recompute when only cosmetic plan fields change (Important 8)', () => {
    // Before this fix, this effect depended on `plan` itself, so it re-ran
    // (and, after the debounce, re-ran computeCoverage's full turf pipeline)
    // on every plan edit whatsoever -- including a plan name/customer
    // keystroke in PlanTree.tsx that never touches aois, docks or params. At
    // 40 docks that is 780 pairwise intersects triggered by typing a
    // customer name, with no geometry having changed at all.
    renderHook(() => useCoverageDriver())
    const base = makePlan(0)

    act(() => {
      usePlanStore.setState({ plan: base })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })
    mockComputeCoverage.mockClear()

    act(() => {
      usePlanStore.setState({
        plan: { ...base, name: 'Renamed Plan', customer: 'New Customer', rev: base.rev + 1 },
      })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(mockComputeCoverage).not.toHaveBeenCalled()
  })

  it('applies coverage computed after a cosmetic rev bump lands within the debounce window of a geometry edit (Important 1)', () => {
    // The exact regression: drag a dock (a genuine geometry edit, rev 1),
    // then -- before the 150ms debounce elapses -- type into the plan Name
    // field (a cosmetic edit, rev 2, with the SAME aois/docks/params
    // references, so the effect's dependency array does not see it and the
    // pending timer is neither cleared nor rescheduled). Before this fix,
    // the timer fired having closed over rev 1 at schedule time, so
    // shouldApply(1, revRef.current=2) discarded the result even though it
    // was computed from the geometry-edited plan, and nothing ever
    // scheduled another run -- the strip was stuck showing pre-drag
    // coverage forever. The fix reads the plan live at fire time instead,
    // so the revision the guard checks and the plan coverage is computed
    // from can never diverge.
    renderHook(() => useCoverageDriver())

    const geometryEditedPlan = makePlan(1)
    const cosmeticPlan = {
      ...geometryEditedPlan,
      name: 'Renamed Mid-Drag',
      rev: 2,
    }

    // computeCoverage is mocked, so tie its return value to the exact plan
    // object it was called with (by reference), not just its rev, so this
    // proves the APPLIED result really is the one computed from the
    // geometry-edited plan, not some other stand-in.
    const geometryResult: CoverageResult = { ok: false, reason: 'no-docks' }
    const otherResult: CoverageResult = { ok: false, reason: 'degenerate' }
    mockComputeCoverage.mockImplementation((plan: DeploymentPlan) =>
      plan === geometryEditedPlan || plan === cosmeticPlan ? geometryResult : otherResult,
    )
    const setCoverageSpy = vi.spyOn(usePlanStore.getState(), 'setCoverage')

    act(() => {
      usePlanStore.setState({ plan: geometryEditedPlan })
    })
    act(() => {
      vi.advanceTimersByTime(50) // well within the 150ms debounce window
    })
    act(() => {
      usePlanStore.setState({ plan: cosmeticPlan })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(setCoverageSpy).toHaveBeenCalledWith(geometryResult)
  })

  it('still recomputes once a genuine geometry/params edit follows a run of cosmetic ones', () => {
    renderHook(() => useCoverageDriver())
    const base = makePlan(0)

    act(() => {
      usePlanStore.setState({ plan: { ...base, name: 'Renamed', rev: 1 } })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })
    mockComputeCoverage.mockClear()

    act(() => {
      usePlanStore.setState({ plan: makePlan(2) })
    })
    act(() => {
      vi.advanceTimersByTime(COVERAGE_DEBOUNCE_MS)
    })

    expect(mockComputeCoverage).toHaveBeenCalledTimes(1)
  })
})
