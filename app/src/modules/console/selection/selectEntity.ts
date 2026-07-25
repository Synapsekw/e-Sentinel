// Ported (Phase 1D / Task 3, extended Phase 1E / Task 1) from
// assets/js/ui/panels.js:2455-2493 (EC2.select), :2440-2449
// (startFollowDriver's header comment, describing the FOLLOW/selection
// contract this module also honors), :2405-2437 (setRightPanel, whose
// FOLLOW-clearing rule at :2417-2421 is transcribed below as applyPanel),
// :2143-2160 (selectedDockId / updateRowSelection), :75-83
// (buildDockIndex/buildSiteIndex) and :2636-2638 (inCaptureMode).
//
// Legacy's EC2.select also stood down manual control / the mission wizard
// before switching selection (panels.js:2455-2467: exitManual()/
// exitWizard() calls guarded on EC2.control.mode). That guard now has a
// real analogue below (selectEntity's capture-mode handoff), backed by the
// store's `controlMode`/`controlActiveId` fields (Phase 1E / Task 1's
// control slice, shared/store.ts).
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

// panels.js:2636-2638 (inCaptureMode). Now reads the real control-mode
// slice landed by Phase 1E / Task 1 (shared/store.ts's `controlMode`,
// default 'normal') instead of the Phase 1D placeholder `false`.
export function inCaptureMode(): boolean {
  return useAppStore.getState().controlMode !== 'normal'
}

// The pair of callbacks selectEntity hands control back to when a
// selection change must stand down whichever capture mode currently holds
// the map/right panel (panels.js:2459-2467). Module-level mutable refs,
// defaulting to no-ops, rather than a direct import of Task 2's
// control/useManualControl.ts / Task 3's control/useWizard.ts — those
// hooks live under control/ and would otherwise create an import cycle
// back into this module (every panel component imports selectEntity.ts).
// Console.tsx calls registerCaptureExits once (Task 8) with the real
// exitManual/exitWizard implementations.
interface CaptureExits {
  exitManual: () => void
  exitWizard: () => void
}

let captureExits: CaptureExits = {
  exitManual: () => {},
  exitWizard: () => {},
}

export function registerCaptureExits(exits: CaptureExits): void {
  captureExits = exits
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

// Port of EC2.select (panels.js:2455-2493).
export function selectEntity(
  sel: Selection,
  engine: Engine | null,
  map: maplibregl.Map | null,
): void {
  // panels.js:2459-2462: manual control owns map clicks exclusively while
  // engaged; selecting anything else — a dock, a site, or a different
  // drone — must hand the map back to normal selection/click behavior
  // cleanly first.
  const { controlMode, controlActiveId } = useAppStore.getState()
  if (controlMode === 'manual' && !(sel.type === 'drone' && sel.id === controlActiveId)) {
    captureExits.exitManual()
  }
  // panels.js:2463-2466: the mission wizard owns the right panel
  // exclusively while engaged — any selection made elsewhere (dock list
  // row, etc.) cancels it cleanly first rather than leaving stale wizard
  // state under a panel swap.
  if (controlMode === 'wizard') {
    captureExits.exitWizard()
  }

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
// Legacy's OPS handler exited whichever capture mode held the map before
// clearing (panels.js:2506-2507), so a stranded wizard/manual overlay could
// never outlive the selection it belonged to. Same courtesy here, through
// the registerCaptureExits registry.
export function clearSelection(): void {
  const { controlMode, setSelection, setFollowDroneId, setRightPanel } = useAppStore.getState()
  if (controlMode === 'manual') captureExits.exitManual()
  else if (controlMode === 'wizard') captureExits.exitWizard()
  setSelection(null)
  setFollowDroneId(null)
  setRightPanel({ mode: 'empty' })
}

// MEDIA button (panels.js:2520-2527): identical capture-mode/selection
// teardown to clearSelection, but landing on the media library instead of
// the ops digest.
export function openMediaLibrary(): void {
  clearSelection()
  useAppStore.getState().setRightPanel({ mode: 'media' })
}

// openDebrief (panels.js:1085-1097): same teardown, landing on a mission's
// debrief. Lives here rather than in panels/ so every entry point (the
// DEBRIEF READY ticker chip, a MEDIA card, a DELIVERED request row, and
// useDebriefWatch's auto-open) shares one implementation that stands down
// manual control / the wizard first, exactly as legacy's did.
export function openDebrief(missionId: string): void {
  clearSelection()
  useAppStore.getState().setRightPanel({ mode: 'debrief', id: missionId })
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
