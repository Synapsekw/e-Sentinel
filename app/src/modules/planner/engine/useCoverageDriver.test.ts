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

function makePlan(rev: number): DeploymentPlan {
  return { ...BASE_PLAN, rev }
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
    // This suite's vite config does not set test.globals: true, so
    // @testing-library/react's auto-cleanup (which hooks a global afterEach)
    // never registers. Without an explicit cleanup(), a renderHook instance
    // from one test stays mounted and subscribed to usePlanStore, so it
    // keeps reacting to store updates made by later tests.
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
})
