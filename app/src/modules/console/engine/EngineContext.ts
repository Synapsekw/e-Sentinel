// Analogous to MapContext.ts (Phase 1B): the single sim Engine instance
// lives in a ref owned by the hook that creates it (useSimEngine), exposed
// to descendants through this context instead of a global (legacy attached
// it to `window.__engine`, main.js:52-54).

import { createContext, useContext } from 'react'
import type { MutableRefObject } from 'react'
import type { Engine } from '@/modules/console/domain'

export interface EngineContextValue {
  engineRef: MutableRefObject<Engine | null>
  started: boolean
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngine must be used within <EngineProvider>')
  return ctx
}
