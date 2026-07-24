// Ported (Phase 1B / Task 3). Legacy map.js attached the single MapLibre
// instance directly to the EC2 global (`EC2.map`) and every other lane read
// it off that global. The React port keeps the same "one instance, read
// everywhere" shape, but scopes it to a React context instead of a global:
// <MapView> owns the ref and provides it here; descendants call useMap().

import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'

export interface MapContextValue {
  mapRef: MutableRefObject<maplibregl.Map | null>
  ready: boolean
}

export const MapContext = createContext<MapContextValue | null>(null)

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMap must be used within <MapView>')
  return ctx
}
