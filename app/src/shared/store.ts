import { create } from 'zustand'

export type Scene = 'globe' | 'console'
export type MapLayer = 'dark' | 'light' | 'sat' | 'terrain'

export interface AppState {
  scene: Scene
  layer: MapLayer
  offline: boolean
  setScene: (scene: Scene) => void
  setLayer: (layer: MapLayer) => void
  setOffline: (offline: boolean) => void
}

// Global UI store. Scene starts 'globe' (orbital boot), layer 'dark' — matching
// the legacy EC2.state defaults. Non-React code (rAF drivers) reads via
// useAppStore.getState() and reacts via useAppStore.subscribe().
export const useAppStore = create<AppState>((set) => ({
  scene: 'globe',
  layer: 'dark',
  offline: false,
  setScene: (scene) => set({ scene }),
  setLayer: (layer) => set({ layer }),
  setOffline: (offline) => set({ offline }),
}))
