import type { Aoi, DeploymentPlan, PlannedDock } from './types'

export const PLAN_SCHEMA_VERSION = 1
export const DEFAULT_PARAMS = { targetOverlapPct: 20, requiredCoveragePct: 95 }

// Monotonic counter, NOT Math.random or Date.now: ids must be reproducible
// so auto-placement output can be asserted byte-for-byte in tests.
let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}
export function resetIdsForTest(): void {
  seq = 0
}

// Wall-clock reads make the otherwise-pure domain layer non-reproducible, which
// is the same problem nextId solves for ids. Tests pin this so a mutation can be
// asserted byte-for-byte; production leaves it alone.
let now = (): string => new Date().toISOString()

export function setNowForTest(fn: () => string): void {
  now = fn
}

export function resetNowForTest(): void {
  now = () => new Date().toISOString()
}

function bump(plan: DeploymentPlan, patch: Partial<DeploymentPlan>): DeploymentPlan {
  return { ...plan, ...patch, rev: plan.rev + 1, updatedAt: now() }
}

export function createPlan(opts?: {
  name?: string
  customer?: string
  now?: string
}): DeploymentPlan {
  const createdAt = opts?.now ?? now()
  return {
    id: nextId('plan'),
    name: opts?.name ?? 'UNTITLED PLAN',
    customer: opts?.customer ?? '',
    createdAt,
    updatedAt: createdAt,
    schemaVersion: PLAN_SCHEMA_VERSION,
    aois: [],
    docks: [],
    params: { ...DEFAULT_PARAMS },
    rev: 0,
  }
}

export const addAoi = (p: DeploymentPlan, aoi: Aoi) => bump(p, { aois: [...p.aois, aoi] })
export const removeAoi = (p: DeploymentPlan, id: string) =>
  bump(p, { aois: p.aois.filter((a) => a.id !== id) })
export const addDock = (p: DeploymentPlan, dock: PlannedDock) =>
  bump(p, { docks: [...p.docks, dock] })
export const removeDock = (p: DeploymentPlan, id: string) =>
  bump(p, { docks: p.docks.filter((d) => d.id !== id) })
export const updateDock = (p: DeploymentPlan, id: string, patch: Partial<PlannedDock>) =>
  bump(p, { docks: p.docks.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
export const setDocks = (p: DeploymentPlan, docks: PlannedDock[]) => bump(p, { docks: [...docks] })
export const setParams = (p: DeploymentPlan, params: DeploymentPlan['params']) =>
  bump(p, { params: { ...params } })
