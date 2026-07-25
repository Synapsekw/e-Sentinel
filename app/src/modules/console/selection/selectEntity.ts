// Ported (Phase 1D / Task 3) from assets/js/ui/panels.js:2455-2493
// (EC2.select), :2440-2449 (startFollowDriver's header comment, describing
// the FOLLOW/selection contract this module also honors), :2405-2437
// (setRightPanel, whose FOLLOW-clearing rule at :2417-2421 is transcribed
// below as applyPanel), :2143-2160 (selectedDockId / updateRowSelection)
// and :75-83 (buildDockIndex/buildSiteIndex).
//
// Legacy's EC2.select also stood down manual control / the mission wizard
// before switching selection (panels.js:2459-2467: exitManual()/
// exitWizard() calls guarded on EC2.control.mode). Manual control and the
// wizard are Phase 1E scope (see the plan's Global Constraints) — that
// guard has no analogue here yet. inCaptureMode() below is exactly the
// seam Phase 1E will widen to reintroduce it; every call site that must
// respect it (selectEntity's callers in useMapSelection.ts, and the future
// dock-list row click) already guards on it.
//
// setRightPanel's other half — killing the previous mode's 2 Hz drone
// telemetry timer / 1 Hz ops-digest timer / debrief rAF loop
// unconditionally on every switch (panels.js:2409-2415) — has no analogue
// here either: those were legacy's manual interval bookkeeping for
// innerHTML-painted panels. In the React port each panel component owns
// its own timer via its own effect cleanup, which fires automatically
// when RightPanel swaps which panel component is mounted.

import type maplibregl from 'maplibre-gl'
import { DATA_DOCKS, DATA_SITES } from '@/modules/console/domain'
import type { DockSeed, Engine, Site } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import type { RightPanelState, Selection } from '@/shared/store'

// Phase 1E replaces this body once control.js's manual-control / mission-
// wizard capture modes land (panels.js:2643-2646). Every guard site below,
// and in useMapSelection.ts / the future dock-list row click, is already
// wired to respect it, so landing the real implementation later is a
// one-function change.
export function inCaptureMode(): boolean {
  return false
}

// Static seed data -> id-indexed maps, built once at module load. Mirrors
// legacy's buildDockIndex/buildSiteIndex (panels.js:75-83), which ran once
// at boot off the same DATA_DOCKS/DATA_SITES globals; DATA_DOCKS/DATA_SITES
// are static arrays baked into the bundle, so module scope is correct here
// too (no per-instance/per-test reset needed).
export const DOCK_INDEX: Map<string, DockSeed> = new Map(DATA_DOCKS.map((d) => [d.id, d]))
export const SITE_INDEX: Map<string, Site> = new Map(DATA_SITES.map((s) => [s.id, s]))

// The store-side half of legacy's setRightPanel contract (panels.js:2417-2421):
// FOLLOW survives only a re-selection of the exact same drone; any other
// panel change (a different drone, a dock, a site, or back to empty) clears
// followDroneId. Every selectEntity branch below goes through this.
export function applyPanel(next: RightPanelState): void {
  const { followDroneId, setFollowDroneId, setRightPanel } = useAppStore.getState()
  const stillFollowingSameDrone = next.mode === 'drone' && followDroneId === next.id
  if (followDroneId && !stillFollowingSameDrone) setFollowDroneId(null)
  setRightPanel(next)
}

// Port of EC2.select (panels.js:2469-2493).
export function selectEntity(
  sel: Selection,
  engine: Engine | null,
  map: maplibregl.Map | null,
): void {
  if (sel.type === 'dock') {
    const dock = DOCK_INDEX.get(sel.id)
    if (!dock) return
    const prev = useAppStore.getState().selection
    const changed = !(prev && prev.type === 'dock' && prev.id === sel.id)
    useAppStore.getState().setSelection({ type: 'dock', id: sel.id })
    applyPanel({ mode: 'dock', id: sel.id })
    if (changed && map) map.flyTo({ center: dock.coords, zoom: 11 })
    return
  }

  if (sel.type === 'drone') {
    if (!engine) return
    const drone = engine.drones.get(sel.id)
    if (!drone) return
    useAppStore.getState().setSelection({ type: 'drone', id: sel.id })
    // No flyTo here — FOLLOW (useFollowDriver.ts) drives the camera for a
    // live drone; an unrequested jump on every selection would fight the
    // operator (panels.js:2482-2483's comment, transcribed).
    applyPanel({ mode: 'drone', id: sel.id })
    return
  }

  // sel.type === 'site'
  const site = SITE_INDEX.get(sel.id)
  if (!site) return
  useAppStore.getState().setSelection({ type: 'site', id: sel.id })
  // No dock-list row matches a site; this just clears any dock highlight
  // (panels.js:2487-2489's comment, transcribed).
  applyPanel({ mode: 'site', id: sel.id })
}

// OPS button / globe-scene exit (panels.js:2504-2512, :2622-2629).
export function clearSelection(): void {
  const { setSelection, setFollowDroneId, setRightPanel } = useAppStore.getState()
  setSelection(null)
  setFollowDroneId(null)
  setRightPanel({ mode: 'empty' })
}

// A drone selection still "belongs" to a dock row (D-<dockId> -> dockId),
// so the list row stays highlighted whichever way the drone was selected
// (panels.js:2145-2151).
export function selectedDockId(selection: Selection | null): string | null {
  if (!selection) return null
  if (selection.type === 'dock') return selection.id
  if (selection.type === 'drone') return selection.id.replace(/^D-/, '')
  return null
}
