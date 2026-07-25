import { create } from 'zustand'
import type { CoverageResult, DeploymentPlan } from '../domain/types'
import { createPlan } from '../domain/plan'

export type PlannerSelection = { type: 'aoi' | 'dock'; id: string } | null

interface PlanState {
  plan: DeploymentPlan
  coverage: CoverageResult
  selection: PlannerSelection
  setPlan(next: DeploymentPlan): void
  setCoverage(next: CoverageResult): void
  select(sel: PlannerSelection): void
}

// A planner-local store, deliberately NOT a slice of shared/store.ts:
// nothing outside /planner reads a plan, and the plan mutates on every
// interaction. Keeping it separate stops the global store growing a large
// feature-specific surface.
export const usePlanStore = create<PlanState>((set) => ({
  plan: createPlan(),
  coverage: { ok: false, reason: 'no-aoi' },
  selection: null,
  setPlan: (plan) => set({ plan }),
  setCoverage: (coverage) => set({ coverage }),
  select: (selection) => set({ selection }),
}))
