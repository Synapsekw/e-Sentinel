// New (Phase 1E / Task 1). Publishes the single LiveLayerUpdater instance
// (map/updateLiveLayers.ts, Phase 1C) that useLiveLayers() drives every
// frame, so `setRangeHighlight(dockId)` — a Phase 1C deferral recorded in
// that file's header comment — is reachable from components that don't
// call useLiveLayers() themselves: the manual-control hook (Task 2) and
// the mission wizard (Task 3) both need it to spotlight one dock's
// coverage ring while they hold the map (control.js:147-150, :608-614).
//
// Modeled on map/MapContext.ts: Console.tsx now creates the one
// createLiveLayerUpdater() instance for the mount, passes it into
// useLiveLayers(updater), and provides that same instance here.
// useUpdater() returns null (rather than throwing) when no provider is
// mounted, mirroring panels/hooks.ts's useOptionalEngine/useOptionalMap —
// so a panel component can call it without every test needing to stand up
// a full <Console> provider tree.

import { createContext, useContext } from 'react'
import type { LiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'

export const UpdaterContext = createContext<LiveLayerUpdater | null>(null)

export function useUpdater(): LiveLayerUpdater | null {
  return useContext(UpdaterContext)
}
