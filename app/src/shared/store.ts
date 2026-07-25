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

export interface AppState {
  scene: Scene
  layer: MapLayer
  offline: boolean
  timeScale: number
  selection: Selection | null
  followDroneId: string | null
  stats: GridStats
  setScene: (scene: Scene) => void
  setLayer: (layer: MapLayer) => void
  setOffline: (offline: boolean) => void
  setTimeScale: (timeScale: number) => void
  setSelection: (selection: Selection | null) => void
  setFollowDroneId: (followDroneId: string | null) => void
  setStats: (stats: GridStats) => void
}

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
  setScene: (scene) => set({ scene }),
  setLayer: (layer) => set({ layer }),
  setOffline: (offline) => set({ offline }),
  setTimeScale: (timeScale) => set({ timeScale }),
  setSelection: (selection) => set({ selection }),
  setFollowDroneId: (followDroneId) => set({ followDroneId }),
  setStats: (stats) => set({ stats }),
}))
