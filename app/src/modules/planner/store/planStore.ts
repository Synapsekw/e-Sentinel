import { create } from 'zustand'
import type { CoverageResult, DeploymentPlan } from '../domain/types'
import { createPlan } from '../domain/plan'

export type PlannerSelection = { type: 'aoi' | 'dock'; id: string } | null

interface PlanState {
  plan: DeploymentPlan
  coverage: CoverageResult
  selection: PlannerSelection
  // The plan revision last written to the library, PAIRED WITH THE PLAN ID it
  // was captured for. Null means "never saved".
  //
  // The id is load-bearing, not decoration. A bare revision number would be
  // compared against whatever plan happens to be loaded, and createPlan()
  // starts every plan at rev 0 -- so a whole-plan swap that does not go
  // through loadPlan (IMPORT PLAN does exactly this, via setPlan) could leave
  // a revision that coincidentally matches, and the UI would report an unsaved
  // plan as saved. Pairing makes that unrepresentable instead of a rule
  // callers have to remember.
  //
  // Session state ABOUT a plan, not content OF one: it lives here rather than
  // on DeploymentPlan so it can never be serialized into an exported file.
  saved: { planId: string; rev: number } | null
  setPlan(next: DeploymentPlan): void
  setCoverage(next: CoverageResult): void
  select(sel: PlannerSelection): void
  setSaved(saved: { planId: string; rev: number } | null): void
  loadPlan(next: DeploymentPlan, saved: { planId: string; rev: number } | null): void
}

// Exported so every caller asks the same question the same way. A plan is
// dirty if it has never been saved, if the saved pairing belongs to a
// different plan, or if it has been mutated since that save.
export function isDirty(
  plan: DeploymentPlan,
  saved: { planId: string; rev: number } | null,
): boolean {
  return saved === null || saved.planId !== plan.id || saved.rev !== plan.rev
}

// A planner-local store, deliberately NOT a slice of shared/store.ts:
// nothing outside /planner reads a plan, and the plan mutates on every
// interaction. Keeping it separate stops the global store growing a large
// feature-specific surface.
export const usePlanStore = create<PlanState>((set) => ({
  plan: createPlan(),
  coverage: { ok: false, reason: 'no-aoi' },
  selection: null,
  saved: null,
  setPlan: (plan) => set({ plan }),
  setCoverage: (coverage) => set({ coverage }),
  select: (selection) => set({ selection }),
  setSaved: (saved) => set({ saved }),
  // Swapping in a whole plan clears the selection in the SAME update. A
  // selection is an id into the plan that is being replaced, so leaving it
  // set would point the Inspector at an aoi/dock that no longer exists.
  loadPlan: (plan, saved) => set({ plan, saved, selection: null }),
}))
