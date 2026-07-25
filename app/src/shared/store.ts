import { create } from 'zustand'
// Type-only import from the console feature's domain layer, needed to type
// the control/wizard/session-mission slice below (WizardState's `type`/
// `points` fields, `sessionMissions: Mission[]`). This differs from the
// "shared must not import from a feature module" note on appendCapped
// below, which is about runtime logic ownership (avoiding a shared helper
// becoming a disguised feature dependency) — a type-only import of pure
// data shapes carries no runtime coupling, and `domain` has no dependency
// on `shared` in the other direction, so no cycle is possible.
import type { LonLat, Mission, MissionType } from '@/modules/console/domain'

export type Scene = 'globe' | 'console'
export type MapLayer = 'dark' | 'light' | 'sat' | 'terrain'

// Mirrors legacy's EC2.control.mode (control.js:9-19's control object):
// 'normal' everywhere except while manual drone control or the mission
// wizard holds the map/right panel exclusively. Read by
// selection/selectEntity.ts's inCaptureMode() and every map-click handler
// that must stand down while a capture mode is active.
export type ControlMode = 'normal' | 'manual' | 'wizard'

// Mission wizard state (control.js:198-200's `control.wizard = { step,
// type, dockId, points, spacingM, altM, speedMs, error }` comment, plus
// `rangeWarning` from the click-validation path at :535-572).
//
// DESIGN NOTE (Phase 1E / Task 1): this belongs conceptually to Task 3's
// control/wizardModel.ts, but is defined here instead to avoid an import
// cycle — store.ts needs the shape for the `wizard` slice field below, and
// every other Task 1-8 consumer (controlModel.ts, useWizard.ts,
// WizardPanel.tsx, useCaptureMapClicks.ts) needs it too. wizardModel.ts
// imports WizardState back from here as a type-only import rather than
// store.ts reaching into a control/ module.
export interface WizardState {
  step: 1 | 2 | 3
  type: MissionType | null
  dockId: string | null
  points: LonLat[]
  spacingM: number
  altM: number | null
  speedMs: number | null
  error: string | null
  rangeWarning: string | null
}

// Mirrors the legacy EC2.state.selection shape (main.js:2): the currently
// selected dock/drone/site, driving panel + map-highlight state.
export interface Selection {
  type: 'dock' | 'drone' | 'site'
  id: string
}

// Airborne/ready/charging/alert counts derived from live engine state
// (mirrors main.js:35-49 EC2.refreshCounts) — drives header chips + sidebar
// grid-stats tiles.
export interface GridStats {
  ready: number
  flying: number
  charge: number
  alert: number
}

// One ticker chip (mirrors the DOM a legacy .tick-ev span carried — see
// panels.js:2366-2391 pushEvent). `id` is assigned by pushTickerEvent from a
// module-scoped counter (not Date.now/Math.random) purely for a stable React
// key; it has no meaning to the sim. `droneId` is non-null only when `source`
// names a live drone entity (see tickerModel.ts's mapEngineEvent) — Ticker.tsx
// reads it for future click-through, which is Phase 1D's job, not this one's.
export interface TickerEvent {
  id: number
  time: string
  source: string
  message: string
  level: 'info' | 'warn' | 'alert'
  droneId: string | null
}

// The shape a caller (tickerModel.ts's mapEngineEvent) supplies to
// pushTickerEvent: everything on TickerEvent except the id, which
// pushTickerEvent assigns itself from the module-scoped counter below.
export type TickerEventInput = Omit<TickerEvent, 'id'>

// panels.js:2390's `while (stream.children.length > 30) ...` cap, so a long
// sim run can't grow the ticker (and thus this store slice) without bound.
const TICKER_CAP = 30

// panels.js:1099-1122's SESSION_MISSIONS_CAP — bounds the debrief/MEDIA
// library's `sessionMissions` list the same way TICKER_CAP bounds the
// ticker. Task 5's debriefModel.ts also exports this value (for its own
// module's tests to import without reaching into shared/store.ts); both
// copies must stay in sync with control.js/panels.js's `40`.
const SESSION_MISSIONS_CAP = 40

// Bounded newest-first insert (pushEvent, panels.js:2384+2390: `insertBefore
// (..., stream.firstChild)` then `while (stream.children.length > 30)
// stream.removeChild(stream.lastChild)`). Generic (and DOM-free) so it's
// unit-testable without constructing TickerEvent values. Lives here (shared)
// rather than in the console feature's tickerModel.ts — pushTickerEvent
// below is its only real caller, and shared code must not import from a
// feature module (tickerModel.ts imports TickerEventInput from here instead,
// the other direction).
export function appendCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [item, ...list]
  return next.length > cap ? next.slice(0, cap) : next
}

// Replaces legacy's setRightPanel(mode, data) argument pair (panels.js's
// module-level right-panel state) — the panel now stores an id, not an
// entity object, so every render reads live engine state (panels.js's
// renderRequestPanel already did this deliberately, panels.js:1376-1380;
// applying it uniformly is the one intentional improvement in Phase 1D).
// Phase 1E / Task 1 widens this union with the five remaining right-panel
// modes so Tasks 3 (wizard), 5 (debrief), 6 (media) and 7 (request, track)
// can each add their own RightPanel.tsx case independently. Until each
// task lands, RightPanel.tsx falls back to <OpsDigestPanel/> for its mode
// (see that file's comments for which task owns which).
export type RightPanelState =
  | { mode: 'empty' }
  | { mode: 'dock'; id: string }
  | { mode: 'drone'; id: string }
  | { mode: 'site'; id: string }
  | { mode: 'wizard' }
  | { mode: 'debrief'; id: string }
  | { mode: 'media' }
  | { mode: 'request'; id: string }
  | { mode: 'track'; id: string }

// The 11 dock-list filter chips (panels.js:1950 FILTER_KEYS), replacing
// legacy's module-level `currentFilter` (panels.js:9).
export type FilterKey =
  'ALL' | 'AUH' | 'DXB' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ' | 'AAN' | 'FLYING' | 'ALERTS'

// Dock-list sort mode (panels.js:2020-2047's sort segment), replacing
// legacy's module-level `dockSort` (panels.js:27).
export type DockSort = 'ID' | 'BATT' | 'STATE'

// The top-menu dropdowns (DOCKS/FILTER/LAYERS, plus Phase 1E / Task 4's
// MISSIONS), replacing legacy's implicit "which .top-menu has .open" DOM
// state (panels.js:1863-1936).
export type TopMenuName = 'docks' | 'filter' | 'layers' | 'missions'

export interface AppState {
  scene: Scene
  layer: MapLayer
  offline: boolean
  timeScale: number
  selection: Selection | null
  followDroneId: string | null
  stats: GridStats
  tickerEvents: TickerEvent[]
  // Right-panel mode (replaces legacy's setRightPanel state, panels.js's
  // module scope).
  rightPanel: RightPanelState
  // Dock-list filter/search/sort (replaces legacy's `currentFilter`
  // panels.js:9, `dockSearch` panels.js:26, `dockSort` panels.js:27).
  dockFilter: FilterKey
  dockSearch: string
  dockSort: DockSort
  // Left/right panel collapse (replaces legacy's `body.side-collapsed` /
  // `body.rpanel-collapsed` classes, panels.js:2568-2585).
  sideCollapsed: boolean
  rpanelCollapsed: boolean
  // Which top-menu dropdown is open, if any (replaces legacy's DOM-tracked
  // open .top-menu, panels.js:1863-1936).
  openMenu: TopMenuName | null
  // Phase 1E / Task 1: legacy's control object (control.js:9-19) folded
  // into the store. `controlMode`/`controlActiveId` replace
  // `control.mode`/`control.activeId`; `controlFollowWasAuto` replaces
  // `control._followWasAuto`; `wizard` replaces `control.wizard`.
  // `userMissions` replaces `control.userMissions` (a `Set` in legacy) —
  // kept as an array here, not a Set, so Zustand's shallow-equality checks
  // stay value-based (a Set never compares equal to a different Set
  // instance with the same members).
  controlMode: ControlMode
  controlActiveId: string | null
  controlFollowWasAuto: boolean
  wizard: WizardState | null
  userMissions: string[]
  // Completed missions recorded for the debrief/MEDIA library
  // (panels.js:1099-1122's recordCompletedMission). Empty until Task 5
  // wires useDebriefWatch(); declared now so Task 6's MediaPanel.tsx and
  // Task 5's DebriefPanel.tsx can both build against a stable field.
  sessionMissions: Mission[]
  setScene: (scene: Scene) => void
  setLayer: (layer: MapLayer) => void
  setOffline: (offline: boolean) => void
  setTimeScale: (timeScale: number) => void
  setSelection: (selection: Selection | null) => void
  setFollowDroneId: (followDroneId: string | null) => void
  setStats: (stats: GridStats) => void
  pushTickerEvent: (ev: TickerEventInput) => void
  setRightPanel: (rightPanel: RightPanelState) => void
  setDockFilter: (dockFilter: FilterKey) => void
  setDockSearch: (dockSearch: string) => void
  setDockSort: (dockSort: DockSort) => void
  toggleSideCollapsed: () => void
  toggleRpanelCollapsed: () => void
  setOpenMenu: (openMenu: TopMenuName | null) => void
  // control.enterManual/exitManual/enterWizard/exitWizard (Tasks 2-3) set
  // both fields together in one call, mirroring how legacy always assigned
  // `control.mode` and `control.activeId` as a pair.
  setControlMode: (mode: ControlMode, activeId: string | null) => void
  setControlFollowWasAuto: (followWasAuto: boolean) => void
  setWizard: (wizard: WizardState | null) => void
  // No-op if the id is already present (control.js:17's Set had this for
  // free; the array needs the check made explicit).
  addUserMission: (id: string) => void
  pushSessionMission: (mission: Mission) => void
}

// Module-scoped, monotonic — deliberately NOT Date.now()/Math.random() (the
// brief's explicit constraint) so ticker event ids stay deterministic and
// collision-free across a session, including in tests that push many events
// in the same millisecond.
let nextTickerEventId = 0

// Global UI store. Scene starts 'globe' (orbital boot), layer 'dark',
// timeScale 1, selection null, offline false — matching the legacy
// EC2.state defaults (main.js:2). Non-React code (rAF drivers, the sim tick
// loop) reads via useAppStore.getState() and reacts via
// useAppStore.subscribe().
export const useAppStore = create<AppState>((set) => ({
  scene: 'globe',
  layer: 'dark',
  offline: false,
  timeScale: 1,
  selection: null,
  followDroneId: null,
  stats: { ready: 0, flying: 0, charge: 0, alert: 0 },
  tickerEvents: [],
  rightPanel: { mode: 'empty' },
  dockFilter: 'ALL',
  dockSearch: '',
  dockSort: 'ID',
  sideCollapsed: false,
  rpanelCollapsed: false,
  openMenu: null,
  controlMode: 'normal',
  controlActiveId: null,
  controlFollowWasAuto: false,
  wizard: null,
  userMissions: [],
  sessionMissions: [],
  setScene: (scene) => set({ scene }),
  setLayer: (layer) => set({ layer }),
  setOffline: (offline) => set({ offline }),
  setTimeScale: (timeScale) => set({ timeScale }),
  setSelection: (selection) => set({ selection }),
  setFollowDroneId: (followDroneId) => set({ followDroneId }),
  setStats: (stats) => set({ stats }),
  pushTickerEvent: (ev) =>
    set((state) => ({
      tickerEvents: appendCapped(
        state.tickerEvents,
        { ...ev, id: ++nextTickerEventId },
        TICKER_CAP,
      ),
    })),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setDockFilter: (dockFilter) => set({ dockFilter }),
  setDockSearch: (dockSearch) => set({ dockSearch }),
  setDockSort: (dockSort) => set({ dockSort }),
  toggleSideCollapsed: () => set((state) => ({ sideCollapsed: !state.sideCollapsed })),
  toggleRpanelCollapsed: () => set((state) => ({ rpanelCollapsed: !state.rpanelCollapsed })),
  setOpenMenu: (openMenu) => set({ openMenu }),
  setControlMode: (mode, activeId) => set({ controlMode: mode, controlActiveId: activeId }),
  setControlFollowWasAuto: (followWasAuto) => set({ controlFollowWasAuto: followWasAuto }),
  setWizard: (wizard) => set({ wizard }),
  addUserMission: (id) =>
    set((state) =>
      state.userMissions.includes(id) ? state : { userMissions: [...state.userMissions, id] },
    ),
  pushSessionMission: (mission) =>
    set((state) => ({
      sessionMissions: appendCapped(state.sessionMissions, mission, SESSION_MISSIONS_CAP),
    })),
}))
