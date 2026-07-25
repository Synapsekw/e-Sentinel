// Local helper for the right panel (Phase 1D / Task 7). Not ported from
// panels.js — legacy read `window.__engine` / `EC2.map` off globals
// anywhere it needed them, so it never faced this problem.
//
// React's rule against calling hooks conditionally means a component can't
// do `engine ?? useEngine()`. Every panel component here instead accepts an
// optional `engine`/`map` prop (so tests can render it standing alone, with
// no <EngineProvider>/<MapView> in the tree — see RightPanel.test.tsx) and,
// when the prop is omitted, falls back to these two hooks, which read the
// same contexts as useEngine()/useMap() but return null instead of
// throwing when no provider is mounted. This is not something that belongs
// in chrome/format.ts (it is React-context plumbing, not a formatting
// helper), so per the Task 7 scope fence it is defined locally here and
// reused by every panels/*.tsx file.

import { useContext } from 'react'
import type maplibregl from 'maplibre-gl'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { MapContext } from '@/modules/console/map/MapContext'
import type { Engine } from '@/modules/console/domain'

export function useOptionalEngine(): Engine | null {
  const ctx = useContext(EngineContext)
  return ctx ? ctx.engineRef.current : null
}

export function useOptionalMap(): maplibregl.Map | null {
  const ctx = useContext(MapContext)
  return ctx ? ctx.mapRef.current : null
}
