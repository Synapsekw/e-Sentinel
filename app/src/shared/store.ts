import { create } from 'zustand'

export type Scene = 'globe' | 'console'
export type MapLayer = 'dark' | 'light' | 'sat' | 'terrain'

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
// Phase 1E widens this union to add 'request' | 'track' | 'debrief' |
// 'media' | 'wizard' modes.
export type RightPanelState =
  | { mode: 'empty' }
  | { mode: 'dock'; id: string }
  | { mode: 'drone'; id: string }
  | { mode: 'site'; id: string }

// The 11 dock-list filter chips (panels.js:1950 FILTER_KEYS), replacing
// legacy's module-level `currentFilter` (panels.js:9).
export type FilterKey =
  'ALL' | 'AUH' | 'DXB' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ' | 'AAN' | 'FLYING' | 'ALERTS'

// Dock-list sort mode (panels.js:2020-2047's sort segment), replacing
// legacy's module-level `dockSort` (panels.js:27).
export type DockSort = 'ID' | 'BATT' | 'STATE'

// The three top-menu dropdowns (DOCKS/FILTER/LAYERS), replacing legacy's
// implicit "which .top-menu has .open" DOM state (panels.js:1863-1936).
export type TopMenuName = 'docks' | 'filter' | 'layers'

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
}))
