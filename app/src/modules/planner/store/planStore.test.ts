// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore, isDirty } from './planStore'
import { createPlan, resetIdsForTest } from '../domain/plan'

describe('planStore', () => {
  beforeEach(() => {
    resetIdsForTest()
    usePlanStore.setState({
      plan: createPlan(),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
      saved: null,
    })
  })

  it('setSaved records the plan id and revision a save happened at', () => {
    usePlanStore.getState().setSaved({ planId: 'plan-1', rev: 4 })
    expect(usePlanStore.getState().saved).toEqual({ planId: 'plan-1', rev: 4 })
  })

  it('setSaved(null) resets to unsaved', () => {
    usePlanStore.getState().setSaved({ planId: 'plan-1', rev: 4 })
    usePlanStore.getState().setSaved(null)
    expect(usePlanStore.getState().saved).toBeNull()
  })

  it('loadPlan swaps the plan, sets saved, and clears the selection together', () => {
    // A selection is an id INTO the plan being replaced. Surviving the swap
    // would point the Inspector at an aoi or dock that no longer exists.
    usePlanStore.getState().select({ type: 'aoi', id: 'aoi-1' })
    expect(usePlanStore.getState().selection).not.toBeNull()

    const incoming = createPlan({ name: 'FROM LIBRARY' })
    usePlanStore.getState().loadPlan(incoming, { planId: incoming.id, rev: incoming.rev })

    const state = usePlanStore.getState()
    expect(state.plan.name).toBe('FROM LIBRARY')
    expect(state.saved).toEqual({ planId: incoming.id, rev: incoming.rev })
    expect(state.selection).toBeNull()
  })
})

describe('isDirty', () => {
  it('is dirty when the plan has never been saved', () => {
    const plan = createPlan()
    expect(isDirty(plan, null)).toBe(true)
  })

  it('is dirty when the saved pairing belongs to a different plan', () => {
    // The whole point of pairing rev with planId: a bare rev number could
    // coincidentally match a different plan's rev (createPlan always starts
    // at rev 0), and would wrongly read as clean without the id check.
    const plan = createPlan()
    const saved = { planId: 'some-other-plan-id', rev: plan.rev }
    expect(isDirty(plan, saved)).toBe(true)
  })

  it('is clean when the saved pairing matches the plan id and revision', () => {
    const plan = createPlan()
    const saved = { planId: plan.id, rev: plan.rev }
    expect(isDirty(plan, saved)).toBe(false)
  })

  it('is dirty when the plan has been mutated past the saved revision', () => {
    const plan = createPlan()
    const saved = { planId: plan.id, rev: plan.rev }
    const mutated = { ...plan, rev: plan.rev + 1 }
    expect(isDirty(mutated, saved)).toBe(true)
  })
})
