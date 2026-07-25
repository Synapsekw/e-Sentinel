import { useState } from 'react'
import type { TerraDraw } from 'terra-draw'
import MapView from '@/modules/console/map/MapView'
import { buildBaseStyle } from '@/modules/console/map/style'
import { useMap } from '@/modules/console/map/MapContext'
import { useAoiDraw } from '@/modules/planner/map/useAoiDraw'

// Working camera for the planner: the whole UAE in frame at a zoom you can
// actually place docks at, rather than the console's orbital globe entry.
const PLANNER_CENTER: [number, number] = [54.6, 24.3]
const PLANNER_ZOOM = 6.4

// TEMPORARY (Task 3 spike): exercises useAoiDraw end to end so the terra-draw
// teardown fix can be verified in a real browser. Remove once Task 4+ wires
// the real AOI toolbar. Renders as a child of <MapView> so useMap() can read
// the context it provides.
function AoiDrawTrigger() {
  const { mapRef, ready } = useMap()
  const [lastGeometry, setLastGeometry] = useState<GeoJSON.Polygon | null>(null)
  const controls = useAoiDraw(mapRef, ready, {
    onFinish: (geometry) => {
      console.log('[planner] AOI polygon finished', geometry)
      setLastGeometry(geometry)
    },
  })

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <button
        type="button"
        onClick={() => {
          // TEMP-DIAGNOSTIC (browser-gate investigation, revert after use):
          // reads the mode straight off the window-exposed draw instance
          // (see useAoiDraw.ts) so the controller can confirm setMode is
          // actually reaching terra-draw and changing its internal state.
          const w = window as unknown as { __plannerDraw?: TerraDraw }
          console.log('[planner] mode before setMode', w.__plannerDraw?.getMode())
          controls.setMode('polygon')
          console.log('[planner] mode after setMode', w.__plannerDraw?.getMode())
        }}
        style={{
          font: '700 13px/1 system-ui, sans-serif',
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          padding: '10px 18px',
          background: '#fbbf24',
          color: '#111',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        }}
      >
        Draw polygon
      </button>
      {lastGeometry ? (
        <pre
          style={{
            margin: 0,
            maxWidth: 360,
            maxHeight: 160,
            overflow: 'auto',
            background: 'rgba(0,0,0,.75)',
            color: '#e5e7eb',
            fontSize: 11,
            padding: 8,
            borderRadius: 6,
          }}
        >
          {JSON.stringify(lastGeometry, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

export default function Planner() {
  return (
    <div className="planner-root">
      <MapView
        initialCenter={PLANNER_CENTER}
        initialZoom={PLANNER_ZOOM}
        styleSpec={buildBaseStyle()}
      >
        <AoiDrawTrigger />
      </MapView>
    </div>
  )
}
