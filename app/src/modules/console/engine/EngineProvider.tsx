// Ported (Phase 1C / Task 3) from assets/js/main.js:11-15 & :51-54
// (EC2.init's console-scene gate + startEngine's `window.__engine` guard).
//
// CONTROLLER DECISION: mounted ABOVE the router in App.tsx (not wrapping the
// <Console> route component). Console is a route element that unmounts when
// the user navigates back to `/` and remounts on the next `/console` visit;
// if the engine ref lived inside it, every route revisit would silently
// create a brand-new engine and discard all simulation progress. Legacy's
// `window.__engine` (main.js:52) is a page-lifetime singleton that starts on
// first console entry and then "leaves it running" — mounting this provider
// above the routes reproduces that exactly, without resorting to a
// module-level global (which would leak state across tests). useSimEngine()
// itself still only *creates* the engine the first time the store's `scene`
// becomes 'console' (see useSimEngine.ts) — this component's only job is to
// call that hook once and publish its result via EngineContext.
//
// No map access here by design: useMap() only resolves inside <MapView>'s
// subtree (below the router, inside the console route), while this provider
// sits above it. The engine's onEvent subscription (ticker push + launch FX
// pulse) needs the map, so it is wired in useLiveLayers.ts instead, called
// from inside the map subtree where useEngine() + useMap() both resolve.
// This component is left owning only engine creation/ticking + context,
// matching legacy's single `window.__engine` responsibility split across two
// React-appropriate homes.

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { EngineContext } from './EngineContext'
import { useSimEngine } from './useSimEngine'

export interface EngineProviderProps {
  children?: ReactNode
}

export default function EngineProvider({ children }: EngineProviderProps) {
  const { engineRef, started } = useSimEngine()
  // Memoized like MapView's MapContext value, so consumers don't see a new
  // context object identity on every render that doesn't actually change
  // engineRef or started.
  const value = useMemo(() => ({ engineRef, started }), [engineRef, started])

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
