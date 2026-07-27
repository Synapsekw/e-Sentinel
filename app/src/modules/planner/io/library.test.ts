import { describe, it, expect, beforeEach } from 'vitest'
import {
  LIBRARY_PREFIX,
  LIBRARY_VERSION,
  listPlans,
  readPlan,
  savePlan,
  deletePlan,
  hasPlan,
  exportLibrary,
  importLibrary,
} from './library'
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

describe('whole-library export and import', () => {
  beforeEach(() => {
    resetIdsForTest()
    resetNowForTest()
  })

  it('exports every saved plan in one envelope', () => {
    const storage = fakeStorage()
    savePlan(storage, createPlan({ name: 'A' }))
    savePlan(storage, createPlan({ name: 'B' }))
    const envelope = JSON.parse(exportLibrary(storage, '2026-07-27T00:00:00.000Z').json) as {
      libraryVersion: number
      exportedAt: string
      plans: DeploymentPlan[]
    }
    expect(envelope.libraryVersion).toBe(LIBRARY_VERSION)
    expect(envelope.exportedAt).toBe('2026-07-27T00:00:00.000Z')
    expect(envelope.plans.map((p) => p.name).sort()).toEqual(['A', 'B'])
  })

  it('excludes an unreadable entry from the export and reports it as skipped', () => {
    const storage = fakeStorage()
    savePlan(storage, createPlan({ name: 'GOOD' }))
    storage.setItem(`${LIBRARY_PREFIX}plan-broken`, 'not json')
    const result = exportLibrary(storage, '2026-07-27T00:00:00.000Z')
    const envelope = JSON.parse(result.json) as { plans: DeploymentPlan[] }
    expect(envelope.plans.map((p) => p.name)).toEqual(['GOOD'])
    expect(result.skipped).toBe(1)
  })

  it('exports a well-formed empty envelope for an empty library', () => {
    const storage = fakeStorage()
    const result = exportLibrary(storage, '2026-07-27T00:00:00.000Z')
    const envelope = JSON.parse(result.json) as {
      libraryVersion: number
      exportedAt: string
      plans: DeploymentPlan[]
    }
    expect(envelope.libraryVersion).toBe(LIBRARY_VERSION)
    expect(envelope.exportedAt).toBe('2026-07-27T00:00:00.000Z')
    expect(envelope.plans).toEqual([])
    expect(result.skipped).toBe(0)
  })

  it('round-trips an exported library into an empty one', () => {
    const source = fakeStorage()
    savePlan(source, createPlan({ name: 'A' }))
    savePlan(source, createPlan({ name: 'B' }))
    const target = fakeStorage()
    expect(importLibrary(target, exportLibrary(source, '2026-07-27T00:00:00.000Z').json)).toEqual({
      ok: true,
      imported: 2,
      skipped: 0,
    })
    expect(
      listPlans(target)
        .entries.map((p) => p.name)
        .sort(),
    ).toEqual(['A', 'B'])
  })

  it('merges by plan id, overwriting an entry that is already there', () => {
    const storage = fakeStorage()
    const plan = createPlan({ name: 'ORIGINAL' })
    savePlan(storage, plan)
    const renamed = { ...plan, name: 'RENAMED' }
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [renamed],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 1, skipped: 0 })
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['RENAMED'])
  })

  it('counts one import when a single file carries the same id twice', () => {
    const storage = fakeStorage()
    const plan = createPlan({ name: 'FIRST' })
    // Same id, different name -- a hand-edited file, or two exports
    // concatenated. The second write overwrites the first, so exactly one
    // plan lands and the count must say one, not two.
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [plan, { ...plan, name: 'SECOND' }],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 1, skipped: 0 })
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['SECOND'])
  })

  it('imports the good plans and counts the bad ones', () => {
    const storage = fakeStorage()
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [createPlan({ name: 'GOOD' }), { nonsense: true }, null],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 1, skipped: 2 })
    expect(listPlans(storage).entries.map((p) => p.name)).toEqual(['GOOD'])
  })

  it('imports an empty plans array as a no-op', () => {
    const storage = fakeStorage()
    const envelope = JSON.stringify({
      libraryVersion: LIBRARY_VERSION,
      exportedAt: '2026-07-27T00:00:00.000Z',
      plans: [],
    })
    expect(importLibrary(storage, envelope)).toEqual({ ok: true, imported: 0, skipped: 0 })
  })

  it('refuses a library from a newer build rather than partially reading it', () => {
    const storage = fakeStorage()
    const envelope = JSON.stringify({ libraryVersion: 99, exportedAt: 'x', plans: [] })
    const result = importLibrary(storage, envelope)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.message).toContain('99')
  })

  it('refuses a file that is not a library at all, writing nothing', () => {
    const storage = fakeStorage()
    expect(importLibrary(storage, 'not json').ok).toBe(false)
    expect(importLibrary(storage, '{"hello":true}').ok).toBe(false)
    expect(listPlans(storage).entries).toHaveLength(0)
  })
})
