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
// sits above it. The launch-FX-pulse half of the engine's onEvent
// subscription needs the map, so it is wired in useLiveLayers.ts instead,
// called from inside the map subtree where useEngine() + useMap() both
// resolve. This component owns engine creation/ticking + context, plus (as
// of Phase 1D / Task 8) the ticker-push half of that same onEvent
// subscription — moved here from useLiveLayers.ts specifically because it
// needs neither the map nor `ready`, so subscribing here means engine
// events accumulate in the ticker even while the user is on another route
// (before <Console>/<MapView> has ever mounted), matching how a page-lifetime
// `window.__engine.onEvent` behaved in legacy regardless of which screen was
// showing.

import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { EngineContext } from './EngineContext'
import { useSimEngine } from './useSimEngine'
import { attachTickerPush } from './attachTickerPush'

export interface EngineProviderProps {
  children?: ReactNode
}

export default function EngineProvider({ children }: EngineProviderProps) {
  const { engineRef, started } = useSimEngine()
  // Memoized like MapView's MapContext value, so consumers don't see a new
  // context object identity on every render that doesn't actually change
  // engineRef or started.
  const value = useMemo(() => ({ engineRef, started }), [engineRef, started])

  // Attaches once the engine exists (guarded on `started`) and detaches on
  // unmount / engine identity change — same shape as useLiveLayers.ts's
  // event-subscription effect, minus the map/ready inputs this half doesn't
  // need.
  useEffect(() => {
    const engine = engineRef.current
    if (!started || !engine) return
    return attachTickerPush(engine)
  }, [started, engineRef])

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
