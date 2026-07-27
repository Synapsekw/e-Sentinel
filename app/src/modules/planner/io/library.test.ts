import { describe, it, expect, beforeEach } from 'vitest'
import { LIBRARY_PREFIX, listPlans, readPlan, savePlan, deletePlan, hasPlan } from './library'
import { createPlan, resetIdsForTest, resetNowForTest } from '../domain/plan'
import type { DeploymentPlan } from '../domain/types'

// A minimal in-memory Storage. The real localStorage is not used anywhere in
// this suite: the point of injecting Storage is that quota failure and a
// private-window refusal are both reachable from a test.
export function fakeStorage(onSet?: (key: string) => void): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      onSet?.(k)
      map.set(k, v)
    },
  }
}

function planNamed(name: string, updatedAt: string): DeploymentPlan {
  return { ...createPlan({ name }), updatedAt }
}

describe('plan library storage', () => {
  beforeEach(() => {
    resetIdsForTest()
    resetNowForTest()
  })

  it('round-trips a saved plan', () => {
    const storage = fakeStorage()
    const plan = createPlan({ name: 'ABU DHABI CORRIDOR', customer: 'ADNOC' })
    expect(savePlan(storage, plan)).toEqual({ ok: true })
    const out = readPlan(storage, plan.id)
    if (!out.ok) throw new Error(out.message)
    expect(out.plan).toEqual(plan)
  })

  it('reports a plan that is not in the library', () => {
    const out = readPlan(fakeStorage(), 'plan-999')
    expect(out).toEqual({ ok: false, message: 'PLAN NOT IN LIBRARY' })
  })

  it('lists saved plans most-recently-updated first', () => {
    const storage = fakeStorage()
    savePlan(storage, planNamed('OLDEST', '2026-01-01T00:00:00.000Z'))
    savePlan(storage, planNamed('NEWEST', '2026-03-01T00:00:00.000Z'))
    savePlan(storage, planNamed('MIDDLE', '2026-02-01T00:00:00.000Z'))
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['NEWEST', 'MIDDLE', 'OLDEST'])
  })

  it('never lists or touches keys outside its own prefix', () => {
    const storage = fakeStorage()
    storage.setItem('planner.scratch.v2', '{"plan":{}}')
    storage.setItem('unrelated', 'x')
    savePlan(storage, createPlan({ name: 'MINE' }))
    expect(listPlans(storage).entries).toHaveLength(1)
    expect(storage.getItem('planner.scratch.v2')).toBe('{"plan":{}}')
    expect(storage.getItem('unrelated')).toBe('x')
  })

  it('skips an unreadable entry and counts it rather than dropping it silently', () => {
    const storage = fakeStorage()
    const good = createPlan({ name: 'GOOD' })
    savePlan(storage, good)
    storage.setItem(`${LIBRARY_PREFIX}plan-broken`, 'not json at all')
    const listing = listPlans(storage)
    expect(listing.entries.map((p) => p.name)).toEqual(['GOOD'])
    expect(listing.skipped).toBe(1)
  })

  it('skips an entry whose id does not match its key', () => {
    const storage = fakeStorage()
    const good = createPlan({ name: 'GOOD' })
    savePlan(storage, good)
    const misfiled = createPlan({ name: 'MISFILED' })
    storage.setItem(`${LIBRARY_PREFIX}plan-wrong`, JSON.stringify(misfiled))
    const listing = listPlans(storage)
    expect(listing.entries.map((p) => p.name)).toEqual(['GOOD'])
    expect(listing.skipped).toBe(1)
  })

  it('returns a failure instead of throwing when storage is full', () => {
    const storage = fakeStorage((key) => {
      if (key.startsWith(LIBRARY_PREFIX)) throw new DOMException('full', 'QuotaExceededError')
    })
    const result = savePlan(storage, createPlan({ name: 'TOO BIG' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toContain('TOO BIG')
  })

  it('does not claim the disk is full for a non-quota storage failure', () => {
    const storage = fakeStorage((key) => {
      if (key.startsWith(LIBRARY_PREFIX)) throw new DOMException('denied', 'SecurityError')
    })
    const result = savePlan(storage, createPlan({ name: 'PRIVATE WINDOW' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toContain('PRIVATE WINDOW')
    expect(result.message).not.toContain('FULL')
  })

  it('deletes a plan and leaves the rest of the library alone', () => {
    const storage = fakeStorage()
    const a = createPlan({ name: 'A' })
    const b = createPlan({ name: 'B' })
    savePlan(storage, a)
    savePlan(storage, b)
    deletePlan(storage, a.id)
    expect(hasPlan(storage, a.id)).toBe(false)
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['B'])
  })
})
