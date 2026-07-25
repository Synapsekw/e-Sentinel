// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:2405-2437
// (setRightPanel). The store's `rightPanel` slice (set by
// selectEntity/applyPanel in selection/selectEntity.ts) already carries
// setRightPanel's FOLLOW-clearing rule and its dispatch-to-renderer shape,
// so this component's only remaining job is picking which mode component
// to mount — the JSX-side successor to `body.innerHTML = renderer(data)`
// (panels.js:2426).
//
// Each mode component owns its own refresh interval in its own effect, so
// unmounting it — which happens automatically here whenever `rightPanel`
// swaps which component this renders — cleans it up. This replaces
// legacy's droneTeleTimer/digestTimer module globals and the manual
// interval-clearing setRightPanel did unconditionally on every mode switch
// (panels.js:2409-2415); there is no analogue of that clearing code here by
// design.
//
// Phase 1E widens shared/store.ts's RightPanelState union with 'request' |
// 'track' | 'debrief' | 'media' | 'wizard' modes; this switch grows a case
// for each as they land. Until then, any mode this switch doesn't
// recognize (today: only 'empty') falls through to the `default` branch,
// matching legacy's `panelRenderers[mode] || panelRenderers.empty`
// (panels.js:2423).
//
// The ops-digest and drone components below live in files named
// OpsDigestPanel.tsx / DroneTelemetryPanel.tsx rather than the plan's
// proposed OpsDigest.tsx / DronePanel.tsx — see those files' header
// comments for why (a case-insensitive-filesystem collision with the
// same-named opsDigest.ts / dronePanel.ts pure-model modules).

import type maplibregl from 'maplibre-gl'
import type { Engine } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import OpsDigest from './OpsDigestPanel'
import DockPanel from './DockPanel'
import SitePanel from './SitePanel'
import DronePanel from './DroneTelemetryPanel'
import { useOptionalEngine, useOptionalMap } from './hooks'
import './panels.css'

export interface RightPanelProps {
  engine?: Engine | null
  map?: maplibregl.Map | null
}

export default function RightPanel({ engine: engineProp, map: mapProp }: RightPanelProps) {
  const contextEngine = useOptionalEngine()
  const contextMap = useOptionalMap()
  const engine = engineProp !== undefined ? engineProp : contextEngine
  const map = mapProp !== undefined ? mapProp : contextMap
  const rightPanel = useAppStore((s) => s.rightPanel)

  switch (rightPanel.mode) {
    case 'dock':
      return <DockPanel id={rightPanel.id} engine={engine} map={map} />
    case 'drone':
      return <DronePanel id={rightPanel.id} engine={engine} map={map} />
    case 'site':
      return <SitePanel id={rightPanel.id} engine={engine} map={map} />
    default:
      return <OpsDigest engine={engine} map={map} />
  }
}
