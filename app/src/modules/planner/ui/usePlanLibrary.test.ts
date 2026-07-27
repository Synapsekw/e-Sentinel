// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlanLibrary } from './usePlanLibrary'
import type { LibraryMessage } from './usePlanLibrary'
import { usePlanStore } from '../store/planStore'
import { createPlan, addAoi, resetIdsForTest } from '../domain/plan'
import { listPlans, savePlan as savePlanToStorage, LIBRARY_PREFIX } from '../io/library'
import type { Aoi } from '../domain/types'

const square: Aoi = {
  id: 'aoi-fixed',
  name: 'AREA',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.0, 24.0],
        [54.1, 24.0],
        [54.1, 24.1],
        [54.0, 24.1],
        [54.0, 24.0],
      ],
    ],
  },
  source: 'drawn',
  valid: true,
}

function clearLibrary() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LIBRARY_PREFIX)) localStorage.removeItem(key)
  }
}

describe('usePlanLibrary', () => {
  beforeEach(() => {
    resetIdsForTest()
    clearLibrary()
    usePlanStore.getState().loadPlan(createPlan({ name: 'WORKING' }), null)
  })

  it('reports an unsaved plan as dirty', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    expect(result.current.dirty).toBe(true)
  })

  it('is clean straight after a save, and dirty again after an edit', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    expect(result.current.dirty).toBe(false)

    act(() => {
      const state = usePlanStore.getState()
      state.setPlan(addAoi(state.plan, square))
    })
    expect(result.current.dirty).toBe(true)
  })

  it('writes the plan into the library on save', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    expect(listPlans(localStorage).entries.map((p) => p.name)).toEqual(['WORKING'])
  })

  it('save as new mints a fresh entry and switches the working plan to it', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const firstId = usePlanStore.getState().plan.id

    act(() => result.current.saveAsNew())
    const secondId = usePlanStore.getState().plan.id

    expect(secondId).not.toBe(firstId)
    expect(listPlans(localStorage).entries).toHaveLength(2)
    expect(result.current.dirty).toBe(false)
  })

  it('dedupes the name so two saves of UNTITLED PLAN are distinguishable', () => {
    act(() => {
      usePlanStore.getState().loadPlan(createPlan(), null)
    })
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    act(() => result.current.saveAsNew())
    const names = listPlans(localStorage)
      .entries.map((p) => p.name)
      .sort()
    expect(names).toEqual(['UNTITLED PLAN', 'UNTITLED PLAN (2)'])
  })

  it('opening a plan loads it and reports it clean', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => {
      usePlanStore.getState().loadPlan(createPlan({ name: 'SOMETHING ELSE' }), null)
    })
    act(() => result.current.openPlan(savedId))

    expect(usePlanStore.getState().plan.name).toBe('WORKING')
    expect(result.current.dirty).toBe(false)
  })

  it('deleting the open plan leaves it on screen but marks it unsaved', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.deletePlan(savedId))

    expect(usePlanStore.getState().plan.name).toBe('WORKING')
    expect(result.current.dirty).toBe(true)
    expect(listPlans(localStorage).entries).toHaveLength(0)
  })

  it('duplicating copies the entry without changing what is open', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.duplicatePlan(savedId))

    expect(usePlanStore.getState().plan.id).toBe(savedId)
    expect(
      listPlans(localStorage)
        .entries.map((p) => p.name)
        .sort(),
    ).toEqual(['WORKING', 'WORKING COPY'])
  })

  it('renaming the open plan keeps the working plan name in step', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => result.current.savePlan())
    const savedId = usePlanStore.getState().plan.id

    act(() => result.current.renamePlan(savedId, 'RENAMED'))

    expect(usePlanStore.getState().plan.name).toBe('RENAMED')
    expect(listPlans(localStorage).entries.map((p) => p.name)).toEqual(['RENAMED'])
  })

  it('notifies with a message when a save succeeds', () => {
    const notify = vi.fn()
    const { result } = renderHook(() => usePlanLibrary(notify))
    act(() => result.current.savePlan())
    expect(notify).toHaveBeenCalledWith({ level: 'info', text: 'PLAN SAVED' })
  })

  it('adopts ids from a plan opened out of the library, so the next mint cannot collide', () => {
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    // beforeEach's WORKING plan already consumed the counter's first mint
    // ('plan-1'), and createPlan below consumes a second ('plan-2') before
    // its id is overridden -- so the counter sits at 2 regardless of what
    // follows. 'plan-3' is deliberately exactly one past that: if openPlan
    // fails to adopt this plan's id, the counter is still at 2, and
    // saveAsNew's single next mint ('plan-3') collides with THIS entry
    // instead of producing a distinct one. Seeded straight into storage and
    // loaded via openPlan -- not loadPlan -- so adoptIdsFrom is genuinely
    // exercised.
    const restored = { ...createPlan({ name: 'RESTORED' }), id: 'plan-3' }
    savePlanToStorage(localStorage, restored)
    act(() => result.current.refresh())
    act(() => result.current.openPlan('plan-3'))
    expect(usePlanStore.getState().plan.id).toBe('plan-3')

    act(() => result.current.saveAsNew())
    expect(usePlanStore.getState().plan.id).not.toBe('plan-3')
    expect(new Set(listPlans(localStorage).entries.map((p) => p.id)).size).toBe(2)
  })

  it('dedupes names across two saves in a single batch, not just across renders', () => {
    // savePlan() then saveAsNew() with no render between: takenNames() must
    // re-read storage, or it would dedupe saveAsNew's name against the
    // pre-save listing still sitting in React state and mint a duplicate.
    const { result } = renderHook(() => usePlanLibrary(vi.fn()))
    act(() => {
      result.current.savePlan()
      result.current.saveAsNew()
    })
    const names = listPlans(localStorage).entries.map((p) => p.name)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('reports storage as unavailable and notifies an error instead of throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const notify = vi.fn()
    const { result } = renderHook(() => usePlanLibrary(notify))
    expect(result.current.available).toBe(false)

    act(() => result.current.savePlan())
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }))

    spy.mockRestore()
  })

  it('surfaces unreadable entries when exporting the library', () => {
    savePlanToStorage(localStorage, createPlan({ name: 'GOOD' }))
    localStorage.setItem(`${LIBRARY_PREFIX}plan-broken`, 'not json')

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:stub'),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const notify = vi.fn<(message: LibraryMessage) => void>()
    const { result } = renderHook(() => usePlanLibrary(notify))
    act(() => result.current.exportLibraryFile())

    expect(notify).toHaveBeenCalledTimes(1)
    const message = notify.mock.calls[0][0]
    expect(message.level).toBe('error')
    expect(message.text).toContain('1')

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
