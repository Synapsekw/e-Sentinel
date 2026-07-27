// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadScratch } from './scratch'
import { createPlan, resetIdsForTest } from '../domain/plan'

describe('scratch key migration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetIdsForTest()
  })

  it('reads a v1 autosave forward into v2 so in-progress work survives an upgrade', () => {
    const plan = createPlan({ name: 'IN PROGRESS' })
    localStorage.setItem('planner.autosave.v1', JSON.stringify(plan))

    const loaded = loadScratch()

    expect(loaded?.plan.name).toBe('IN PROGRESS')
    // A migrated plan has never been written to the library, so it is unsaved.
    expect(loaded?.saved).toBeNull()
  })

  it('prefers v2 when both keys are present', () => {
    localStorage.setItem('planner.autosave.v1', JSON.stringify(createPlan({ name: 'OLD' })))
    const newer = createPlan({ name: 'NEW' })
    localStorage.setItem(
      'planner.scratch.v2',
      JSON.stringify({ plan: newer, saved: { planId: newer.id, rev: newer.rev } }),
    )

    const loaded = loadScratch()

    expect(loaded?.plan.name).toBe('NEW')
    expect(loaded?.saved).toEqual({ planId: newer.id, rev: newer.rev })
  })

  it('treats an unreadable scratch payload as nothing saved', () => {
    localStorage.setItem('planner.scratch.v2', '{"plan":{"garbage":true}}')
    expect(loadScratch()).toBeNull()
  })

  it('drops a malformed saved pairing rather than trusting it', () => {
    // A hand-edited or older payload could carry anything here. A bad pairing
    // must degrade to "unsaved", never to a pairing that reports a plan as
    // saved when it is not.
    const plan = createPlan({ name: 'PLAN' })
    localStorage.setItem(
      'planner.scratch.v2',
      JSON.stringify({ plan, saved: { planId: 42, rev: 'nope' } }),
    )
    expect(loadScratch()?.saved).toBeNull()
  })

  it('returns null when nothing is stored at all', () => {
    expect(loadScratch()).toBeNull()
  })
})
