import { DOCK_RANGE } from '@/modules/console/domain'
import type { DockModelId, DroneModelId, PlannedDock } from './types'

export interface DroneSpec {
  id: DroneModelId
  label: string
  cruiseKph: number
  enduranceMin: number
  reservePct: number
  onTaskMin: number
}

export interface DockSpec {
  id: DockModelId
  label: string
  drones: DroneModelId[]
}

// PROVISIONAL FIGURES. Drawn from public DJI marketing material for the three
// airframes the simulation already uses; NOT verified against a datasheet.
// The simulation carries no per-drone endurance data of its own (its speedMs
// values are per mission type, not per airframe), so these are new numbers.
// Replacing them is intended to be a one-file change: nothing outside this
// module hardcodes a drone figure.
export const DRONES: Record<DroneModelId, DroneSpec> = {
  M4TD: {
    id: 'M4TD',
    label: 'Matrice 4TD',
    cruiseKph: 54,
    enduranceMin: 48,
    reservePct: 0.3,
    onTaskMin: 5,
  },
  M4D: {
    id: 'M4D',
    label: 'Matrice 4D',
    cruiseKph: 54,
    enduranceMin: 49,
    reservePct: 0.3,
    onTaskMin: 5,
  },
  M350: {
    id: 'M350',
    label: 'Matrice 350 RTK',
    cruiseKph: 61,
    enduranceMin: 55,
    reservePct: 0.3,
    onTaskMin: 5,
  },
}

export const DOCK_MODELS: Record<DockModelId, DockSpec> = {
  DOCK3: { id: 'DOCK3', label: 'DJI Dock 3', drones: ['M4TD', 'M4D'] },
  DOCK2: { id: 'DOCK2', label: 'DJI Dock 2', drones: ['M350'] },
}

export interface RadiusBreakdown {
  radiusKm: number
  enduranceKm: number
  capKm: number
  bound: 'endurance' | 'cap' | 'override'
}

// Split out from effectiveRadius so the endurance-bound branch is reachable in
// a test: no catalogued airframe is currently endurance-bound, but the branch
// must be correct before real datasheet figures arrive.
export function radiusFromTerms(terms: {
  enduranceKm: number
  capKm: number
  override: number | undefined
}): RadiusBreakdown {
  const { enduranceKm, capKm, override } = terms
  if (override != null) return { radiusKm: override, enduranceKm, capKm, bound: 'override' }
  return enduranceKm <= capKm
    ? { radiusKm: enduranceKm, enduranceKm, capKm, bound: 'endurance' }
    : { radiusKm: capKm, enduranceKm, capKm, bound: 'cap' }
}

// The aircraft can usually fly much further than we plan for; BVLOS and
// airspace rules bind first. Reporting both terms lets the inspector show the
// headroom rather than an unexplained number.
export function effectiveRadius(dock: PlannedDock): RadiusBreakdown {
  const spec = DRONES[dock.droneModel]
  const usableMin = spec.enduranceMin * (1 - spec.reservePct)
  const outLegMin = (usableMin - spec.onTaskMin) / 2
  const enduranceKm = Math.max(0, (spec.cruiseKph / 60) * outLegMin)
  const capKm = dock.environment === 'urban' ? DOCK_RANGE.URBAN_RANGE_KM : DOCK_RANGE.RURAL_RANGE_KM
  return radiusFromTerms({ enduranceKm, capKm, override: dock.radiusKmOverride })
}
