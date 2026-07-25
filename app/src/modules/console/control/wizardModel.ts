// Ported (Phase 1E / Task 3) from assets/js/ui/control.js:198-223
// (WIZARD_GLYPHS, isLawnmowerType), :229-272 (wizardBox /
// wizardLawnmowerPath / wizardFinalWaypoints / wizardStep2Valid /
// wizardDistanceKm / wizardDurationLabel), :274-330 (wizardPreviewFeatures /
// wizardReadyDocks / wizardNearestReadyDockId) and :535-572
// (wizardClickOutsideRange / handleWizardMapClick). Only the pure
// computations are ported here — DOM painting (renderWizard*, :336-457),
// the map-source/cursor/right-panel side effects (handleWizardLaunch,
// cleanupWizardUI, enterWizard/exitWizard, wireWizardPanel) live in
// useWizard.ts/WizardPanel.tsx instead, per this file's "no DOM, no
// globals" contract (Global Constraints).
//
// `WizardState` is defined once, in shared/store.ts (see that file's Task 1
// DESIGN NOTE — store.ts needs the shape for its `wizard` slice field and
// would otherwise create an import cycle reaching into this control/
// module), and re-exported here so every other Task 3 file
// (WizardPanel.tsx, useWizard.ts, this file's own test) can import it from
// './wizardModel' as the plan's interface describes.

import type { FeatureCollection, Feature, Point, LineString } from 'geojson'
import { DOCK_RANGE, MISSIONS_CONFIG, SimRouter } from '@/modules/console/domain'
import type { Dock, Engine, LonLat, MissionType } from '@/modules/console/domain'

export type { WizardState } from '@/shared/store'
import type { WizardState } from '@/shared/store'

// control.js:210-218. Glyph shown on each step-1 mission-type tile.
export const WIZARD_GLYPHS: Record<MissionType, string> = {
  security: '◎', // target ring — perimeter patrol
  infra: '▦', // hatched square — corridor inspection
  emergency: '✚', // plus — first response
  delivery: '➤', // arrow — point to point
  construction: '▩', // filled-edge square — survey area
  highway: '═', // double line — corridor
  parks: '❀', // florette — vegetation
}

// control.js:220-223.
export function isLawnmowerType(type: MissionType | null): boolean {
  if (!type) return false
  const cfg = MISSIONS_CONFIG[type]
  return !!cfg && cfg.pattern === 'lawnmower'
}

// control.js:227-237. Box corners -> {center,widthKm,heightKm}, min 0.3km
// sides so a near-zero drag can never reach engine.createMission as a
// degenerate route.
export interface WizardBox {
  center: LonLat
  widthKm: number
  heightKm: number
}

export function wizardBox(w: WizardState): WizardBox | null {
  if (!w.points || w.points.length < 2) return null
  const [c1, c2] = w.points
  const centerLat = (c1[1] + c2[1]) / 2
  const center: LonLat = [(c1[0] + c2[0]) / 2, centerLat]
  const widthKm = Math.max(
    0.3,
    Math.abs(c2[0] - c1[0]) * 111.32 * Math.cos((centerLat * Math.PI) / 180),
  )
  const heightKm = Math.max(0.3, Math.abs(c2[1] - c1[1]) * 110.57)
  return { center, widthKm, heightKm }
}

// control.js:239-243.
export function wizardLawnmowerPath(w: WizardState): LonLat[] | null {
  const box = wizardBox(w)
  if (!box) return null
  return SimRouter.lawnmower(box.center, box.widthKm, box.heightKm, w.spacingM || 150, 0)
}

// control.js:245-250. The exact coordinate list that would be handed to
// engine.createMission — the clicked line for waypoint types, the
// generated serpentine for lawnmower.
export function wizardFinalWaypoints(w: WizardState): LonLat[] {
  if (isLawnmowerType(w.type)) return wizardLawnmowerPath(w) ?? []
  return w.points.slice()
}

// control.js:252-255.
export function wizardStep2Valid(w: WizardState): boolean {
  if (isLawnmowerType(w.type)) return w.points.length === 2
  return w.points.length >= 2
}

// control.js:257-266.
export function wizardDistanceKm(w: WizardState): number {
  if (isLawnmowerType(w.type)) {
    if (w.points.length < 2) return 0
    const path = wizardLawnmowerPath(w)
    return path ? SimRouter.pathLengthKm(path) : 0
  }
  if (w.points.length < 2) return 0
  return SimRouter.pathLengthKm(w.points)
}

// control.js:268-272.
export function wizardDurationLabel(distKm: number, speedMs: number): string {
  if (!distKm || !speedMs) return '--'
  const mins = (distKm * 1000) / speedMs / 60
  return mins < 1 ? '<1 MIN' : Math.round(mins) + ' MIN'
}

// control.js:274-297.
export function wizardPreviewFeatures(w: WizardState): FeatureCollection<Point | LineString> {
  const features: Feature<Point | LineString>[] = []
  if (isLawnmowerType(w.type)) {
    w.points.forEach((p, i) => {
      features.push({
        type: 'Feature',
        properties: { n: i + 1 },
        geometry: { type: 'Point', coordinates: p },
      })
    })
    if (w.points.length === 2) {
      const path = wizardLawnmowerPath(w)
      if (path && path.length >= 2) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: path },
        })
      }
    }
  } else {
    w.points.forEach((p, i) => {
      features.push({
        type: 'Feature',
        properties: { n: i + 1 },
        geometry: { type: 'Point', coordinates: p },
      })
    })
    if (w.points.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: w.points },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// control.js:313-325. Ready docks (drone actually docked there),
// nearest-to-map-center first when a map center is supplied — used both for
// step 1's nearest-preselect and its dropdown ordering. `mapCenter` stands
// in for legacy's `EC2.map.getCenter()` read; passed in as a plain
// parameter (rather than this module reaching for a map instance itself)
// per the "no DOM, no globals" contract above.
export function wizardReadyDocks(engine: Engine | null, mapCenter: LonLat | null): Dock[] {
  if (!engine) return []
  const list: Dock[] = []
  for (const dock of engine.docks.values()) {
    if (dock.state === 'ready' && dock.drone && dock.drone.state === 'docked') list.push(dock)
  }
  if (mapCenter) {
    list.sort((a, b) => SimRouter.distM(mapCenter, a.coords) - SimRouter.distM(mapCenter, b.coords))
  }
  return list
}

// control.js:327-330.
export function wizardNearestReadyDockId(
  engine: Engine | null,
  mapCenter: LonLat | null,
): string | null {
  const docks = wizardReadyDocks(engine, mapCenter)
  return docks.length ? docks[0].id : null
}

// Contract C-1's 5% slack, mirrored from engine.ts's own RANGE_TOLERANCE —
// step-2 clicks are refused client-side with the same tolerance
// createMission itself enforces, so a click accepted here can never fail at
// launch.
const RANGE_TOLERANCE = 1.05

// control.js:535-543. Returns the warning string instead of mutating
// `w.rangeWarning` (this module stays pure) — callers (applyWizardClick
// below) decide what to do with it.
export function wizardClickOutsideRange(
  engine: Engine | null,
  w: WizardState,
  lonlat: LonLat,
): string | null {
  if (!engine || !w.dockId) return null
  const dock = engine.docks.get(w.dockId)
  if (!dock) return null
  const rangeKm = DOCK_RANGE.dockRangeKm(dock)
  if (SimRouter.distM(dock.coords, lonlat) <= rangeKm * 1000 * RANGE_TOLERANCE) return null
  return 'OUTSIDE COVERAGE · ' + rangeKm.toFixed(1) + ' KM MAX'
}

// control.js:545-572 (handleWizardMapClick), as a pure state transition:
// given the wizard state before the click, returns the wizard state after
// it. An out-of-range click returns `w` with only `rangeWarning` set (the
// point is NOT added, matching control.js:548-551). For lawnmower types,
// the derived box corners (control.js:556-563) get the same range check
// before the second corner is accepted, and a third click on an
// already-complete box restarts it (control.js:564).
export function applyWizardClick(
  engine: Engine | null,
  w: WizardState,
  lonlat: LonLat,
): WizardState {
  if (w.step !== 2) return w

  const warning = wizardClickOutsideRange(engine, w, lonlat)
  if (warning) return { ...w, rangeWarning: warning }

  if (isLawnmowerType(w.type)) {
    if (w.points.length === 1) {
      const [c1] = w.points
      const derived: LonLat[] = [
        [c1[0], lonlat[1]],
        [lonlat[0], c1[1]],
      ]
      for (const p of derived) {
        const derivedWarning = wizardClickOutsideRange(engine, w, p)
        if (derivedWarning) return { ...w, rangeWarning: derivedWarning }
      }
    }
    const points = w.points.length >= 2 ? [lonlat] : [...w.points, lonlat]
    return { ...w, points, rangeWarning: null }
  }

  return { ...w, points: [...w.points, lonlat], rangeWarning: null }
}
