// Task 3 (terra-draw spike): AOI drawing on the planner map, with teardown
// guarded the same way as every other map-owning hook in this codebase (see
// the Phase 1F note in mapLifecycle.ts). MapView is the parent of whatever
// renders this hook, so on route navigation away from /planner its cleanup
// (map.remove()) runs BEFORE this one — calling into terra-draw at that
// point would dereference a torn-down MapLibre Style.
//
// terra-draw v1.32.2's real API confirmed by reading
// node_modules/terra-draw/dist/*.d.ts (and the bundled source for behaviour
// not visible in the .d.ts — see teardownDraw's comment below):
//   - TerraDraw's constructor takes { adapter, modes }, matches the brief.
//   - TerraDrawPolygonMode / TerraDrawRectangleMode / TerraDrawCircleMode
//     default their `mode` name to 'polygon' / 'rectangle' / 'circle'
//     (confirmed in the mode classes' constructors), matching AoiDrawMode.
//   - TerraDraw's constructor ALWAYS registers an internal no-interaction
//     mode under the key 'static' (`this._modes = {...userModes, static:
//     this._mode}`), even though the class backing it (TerraDrawStaticMode)
//     is not part of the package's public exports. So `setMode('static')`
//     works out of the box for the 'idle' case without adding anything extra
//     to the `modes` array — the brief's `mode === 'idle' ? 'static' : mode`
//     ternary is correct as written.
//   - `on('finish', (id, context) => void)` and `getSnapshot()` match the
//     brief's usage.
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'

export type AoiDrawMode = 'idle' | 'polygon' | 'rectangle' | 'circle'

interface StoppableDraw {
  stop(): void
}

// Extracted so the teardown ordering rule is unit-testable without a real
// map. See the Phase 1F mapLifecycle note: on route navigation MapView's
// cleanup (map.remove()) runs BEFORE this one, so the map may already be dead.
export function teardownDraw(draw: StoppableDraw | null, map: maplibregl.Map | null): void {
  if (!draw) return
  if (!isMapUsable(map)) return
  draw.stop()
}

export interface AoiDrawControls {
  setMode(mode: AoiDrawMode): void
  cancel(): void
}

export function useAoiDraw(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  // Arrow-typed (not method-shorthand) so storing it in a ref below doesn't
  // trip @typescript-eslint/unbound-method (method shorthand types carry an
  // implicit, possibly-`this`-dependent call signature; a plain function
  // property does not). Same call shape either way for callers.
  opts: { onFinish: (geometry: GeoJSON.Polygon) => void },
): AoiDrawControls {
  const drawRef = useRef<TerraDraw | null>(null)
  const onFinishRef = useRef(opts.onFinish)
  onFinishRef.current = opts.onFinish

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || drawRef.current) return

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawPolygonMode(), new TerraDrawRectangleMode(), new TerraDrawCircleMode()],
    })
    draw.start()
    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id)
      if (feature && feature.geometry.type === 'Polygon') {
        onFinishRef.current(feature.geometry)
        draw.clear()
      }
    })
    drawRef.current = draw

    return () => {
      // Reference the `map` captured above, not mapRef.current: MapView's
      // cleanup (parent, runs first on route navigation) sets
      // mapRef.current to null before this cleanup runs, so re-reading the
      // ref here would only ever see null and never the live-vs-removed
      // distinction teardownDraw's isMapUsable check is for. The captured
      // object itself gets its internal Style nulled by map.remove(), which
      // is what isMapUsable actually detects.
      teardownDraw(drawRef.current, map)
      drawRef.current = null
    }
  }, [mapRef, ready])

  return {
    setMode(mode) {
      const draw = drawRef.current
      if (!draw) return
      draw.setMode(mode === 'idle' ? 'static' : mode)
    },
    cancel() {
      const draw = drawRef.current
      if (!draw) return
      draw.clear()
      draw.setMode('static')
    },
  }
}
