// Ported (Phase 1D / Task 6) from console.html:45-48 (the `.panel.live-net`
// tile markup) and assets/js/ui/panels.js:2550-2558 (wireLiveNetwork's
// click/Enter/Space -> map.flyTo).
//
// Legacy hardcoded "13 LIVE · 4 PLANNED · 2 REPLACE" (console.html:47) --
// this port derives the same three counts from DATA_SITES' `status` field
// instead (19 sites total = 13 installed + 4 not-installed + 2 replace, so
// the numbers land identically), so the tile stays correct if the seed data
// ever changes.

import { useContext } from 'react'
import type maplibregl from 'maplibre-gl'
import { DATA_SITES } from '@/modules/console/domain'
import { MapContext } from '@/modules/console/map/MapContext'

// panels.js:2553's fixed fly target -- a wide UAE-framing view, not any
// particular site.
const LIVE_NETWORK_CENTER: [number, number] = [54.9, 24.3]
const LIVE_NETWORK_ZOOM = 8.3

function useOptionalMap(): maplibregl.Map | null {
  const ctx = useContext(MapContext)
  return ctx ? ctx.mapRef.current : null
}

function countByStatus(status: 'installed' | 'not-installed' | 'replace'): number {
  let n = 0
  for (const s of DATA_SITES) if (s.status === status) n++
  return n
}

export default function LiveNetworkTile() {
  const map = useOptionalMap()
  const live = countByStatus('installed')
  const planned = countByStatus('not-installed')
  const replace = countByStatus('replace')

  const fly = (): void => {
    if (map) map.flyTo({ center: LIVE_NETWORK_CENTER, zoom: LIVE_NETWORK_ZOOM })
  }

  return (
    <div
      className="panel live-net"
      id="live-net"
      role="button"
      tabIndex={0}
      onClick={fly}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          fly()
        }
      }}
    >
      <h4 className="lbl">Live network · {DATA_SITES.length} sites</h4>
      <div className="ln-summary">
        <b className="ln-ok">{live}</b> LIVE · <b className="ln-amber">{planned}</b> PLANNED ·{' '}
        <b className="ln-red">{replace}</b> REPLACE
      </div>
    </div>
  )
}
