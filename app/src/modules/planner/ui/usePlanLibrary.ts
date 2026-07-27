// The seam between the plan store and io/library.ts. Owns the listing and its
// refresh, the dirty flag, every library action, and the alert messages those
// actions produce. PlansMenu.tsx stays presentational; Planner.tsx keeps
// rendering the .pl-alert banner it already owns.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlanStore, isDirty } from '../store/planStore'
import { adoptIdsFrom, nextId, uniqueName } from '../domain/plan'
import {
  listPlans,
  readPlan,
  savePlan as savePlanToStorage,
  deletePlan as deletePlanFromStorage,
  hasPlan,
  exportLibrary,
  importLibrary,
} from '../io/library'
import type { DeploymentPlan } from '../domain/types'

export interface LibraryMessage {
  level: 'error' | 'info'
  text: string
}

export type Notify = (message: LibraryMessage) => void

export interface PlanLibrary {
  entries: DeploymentPlan[]
  skipped: number
  available: boolean
  dirty: boolean
  currentPlanId: string
  isSaved(id: string): boolean
  refresh(): void
  savePlan(): void
  saveAsNew(): void
  openPlan(id: string): void
  renamePlan(id: string, name: string): void
  duplicatePlan(id: string): void
  deletePlan(id: string): void
  exportLibraryFile(): void
  importLibraryFile(file: File): Promise<void>
}

// A write probe, not a truthiness check: Safari private browsing exposes a
// localStorage object whose setItem throws, so `window.localStorage != null`
// says nothing useful. Returns null when the library simply cannot work, and
// every action below then reports that rather than throwing.
function resolveStorage(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__planner_library_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

const UNAVAILABLE: LibraryMessage = {
  level: 'error',
  text: 'BROWSER STORAGE UNAVAILABLE · PLANS CANNOT BE SAVED',
}

export function usePlanLibrary(notify: Notify): PlanLibrary {
  const plan = usePlanStore((s) => s.plan)
  const saved = usePlanStore((s) => s.saved)
  const storage = useMemo(resolveStorage, [])
  const [entries, setEntries] = useState<DeploymentPlan[]>([])
  const [skipped, setSkipped] = useState(0)

  const refresh = useCallback(() => {
    if (!storage) return
    const listing = listPlans(storage)
    setEntries(listing.entries)
    setSkipped(listing.skipped)
  }, [storage])

  useEffect(() => {
    refresh()
  }, [refresh])

  const dirty = isDirty(plan, saved)

  const write = useCallback(
    (next: DeploymentPlan, successText: string): boolean => {
      if (!storage) {
        notify(UNAVAILABLE)
        return false
      }
      const result = savePlanToStorage(storage, next)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return false
      }
      refresh()
      notify({ level: 'info', text: successText })
      return true
    },
    [storage, notify, refresh],
  )

  // Read from storage, not from the `entries` React state: two library writes
  // in the same batch (save, then save-as-new) would otherwise both dedupe
  // against the pre-save list and mint the same name twice. Every other action
  // in this hook re-reads through getState()/storage for exactly this reason.
  const takenNames = useCallback(
    () => (storage ? listPlans(storage).entries.map((e) => e.name) : []),
    [storage],
  )

  const savePlan = useCallback(() => {
    const current = usePlanStore.getState().plan
    if (write(current, 'PLAN SAVED')) {
      usePlanStore.getState().setSaved({ planId: current.id, rev: current.rev })
    }
  }, [write])

  const saveAsNew = useCallback(() => {
    const current = usePlanStore.getState().plan
    // The working plan BECOMES the new entry. Writing a copy while continuing
    // to edit the original would leave `saved` pointing at an entry the user
    // is no longer editing, which breaks the next SAVE PLAN.
    const next: DeploymentPlan = {
      ...current,
      id: nextId('plan'),
      name: uniqueName(current.name, takenNames()),
    }
    if (write(next, 'PLAN SAVED AS NEW')) {
      usePlanStore.getState().loadPlan(next, { planId: next.id, rev: next.rev })
    }
  }, [write, takenNames])

  const openPlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      // Same path IMPORT PLAN and the scratch restore already take: adopt the
      // incoming ids into this session's counter before anything mints a new
      // one against the loaded plan.
      adoptIdsFrom(result.plan)
      usePlanStore
        .getState()
        .loadPlan(result.plan, { planId: result.plan.id, rev: result.plan.rev })
    },
    [storage, notify],
  )

  const renamePlan = useCallback(
    (id: string, name: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const trimmed = name.trim()
      if (trimmed.length === 0) return
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      const renamed = { ...result.plan, name: trimmed }
      if (!write(renamed, 'PLAN RENAMED')) return
      // Keep the working plan's name in step, or the left panel's NAME field
      // would disagree with the library row for the very same plan.
      const current = usePlanStore.getState().plan
      if (current.id === id) usePlanStore.getState().setPlan({ ...current, name: trimmed })
    },
    [storage, notify, write],
  )

  const duplicatePlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      const result = readPlan(storage, id)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      write(
        {
          ...result.plan,
          id: nextId('plan'),
          name: uniqueName(`${result.plan.name} COPY`, takenNames()),
        },
        'PLAN DUPLICATED',
      )
    },
    [storage, notify, write, takenNames],
  )

  const deletePlan = useCallback(
    (id: string) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      deletePlanFromStorage(storage, id)
      refresh()
      // Deleting the plan that is open does NOT clear the screen -- wiping the
      // user's work as a side effect of housekeeping would be far worse than an
      // open plan with no backing entry. It is simply unsaved again, which is
      // the truth.
      if (usePlanStore.getState().plan.id === id) usePlanStore.getState().setSaved(null)
      notify({ level: 'info', text: 'PLAN DELETED' })
    },
    [storage, notify, refresh],
  )

  const exportLibraryFile = useCallback(() => {
    if (!storage) {
      notify(UNAVAILABLE)
      return
    }
    const { json, skipped: unreadable } = exportLibrary(storage, new Date().toISOString())
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'plan-library.json'
    a.click()
    URL.revokeObjectURL(url)
    // An export is what a user relies on before clearing their browser, so a
    // short one must say so. Silence here would be the one failure this
    // feature exists to prevent.
    notify(
      unreadable > 0
        ? { level: 'error', text: `LIBRARY EXPORTED · ${unreadable} COULD NOT BE READ` }
        : { level: 'info', text: 'LIBRARY EXPORTED' },
    )
  }, [storage, notify])

  const importLibraryFile = useCallback(
    async (file: File) => {
      if (!storage) {
        notify(UNAVAILABLE)
        return
      }
      let text: string
      try {
        text = await file.text()
      } catch (err) {
        console.error('[planner] could not read library file', err)
        notify({ level: 'error', text: 'COULD NOT READ FILE' })
        return
      }
      const result = importLibrary(storage, text)
      if (!result.ok) {
        notify({ level: 'error', text: result.message })
        return
      }
      refresh()
      notify({
        level: 'info',
        text:
          result.skipped > 0
            ? `${result.imported} IMPORTED · ${result.skipped} SKIPPED`
            : `${result.imported} IMPORTED`,
      })
    },
    [storage, notify, refresh],
  )

  return {
    entries,
    skipped,
    available: storage !== null,
    dirty,
    currentPlanId: plan.id,
    isSaved: (id: string) => (storage ? hasPlan(storage, id) : false),
    refresh,
    savePlan,
    saveAsNew,
    openPlan,
    renamePlan,
    duplicatePlan,
    deletePlan,
    exportLibraryFile,
    importLibraryFile,
  }
}
