// Ticker-push half of legacy's engine.onEvent wiring (main.js:56-57,
// `EC2.ui.pushEvent`), split out of EngineProvider.tsx (Phase 1D / Task 8)
// into its own plain (non-component) module for two reasons: it mirrors
// useLiveLayers.ts's attachEngineEvents/startRenderLoop split, letting
// EngineProvider.test.tsx drive it directly with a fake engine and a
// stubbed store without a React render; and a file that default-exports a
// component may only otherwise export constants (react-refresh/
// only-export-components), which a second function export here would trip.

import type { Engine } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { mapEngineEvent, nowClockStr } from '@/modules/console/hud/tickerModel'

export function attachTickerPush(engine: Engine): () => void {
  const cb = engine.onEvent((ev) => {
    useAppStore.getState().pushTickerEvent(mapEngineEvent(ev, nowClockStr))
  })
  return () => engine.offEvent(cb)
}
