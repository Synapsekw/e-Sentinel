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

export interface AppState {
  scene: Scene
  layer: MapLayer
  offline: boolean
  timeScale: number
  selection: Selection | null
  followDroneId: string | null
  stats: GridStats
  tickerEvents: TickerEvent[]
  setScene: (scene: Scene) => void
  setLayer: (layer: MapLayer) => void
  setOffline: (offline: boolean) => void
  setTimeScale: (timeScale: number) => void
  setSelection: (selection: Selection | null) => void
  setFollowDroneId: (followDroneId: string | null) => void
  setStats: (stats: GridStats) => void
  pushTickerEvent: (ev: TickerEventInput) => void
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
}))
