// Ported (Phase 1B / Task 3) from assets/js/ui/map.js:862-895: the map
// construction options, the compact AttributionControl (:877), and the
// 'load' handler that seeds the three icon images and flips readiness
// (:879-895 — the ping driver / scene-change wiring for icon images belongs
// to later tasks; only the map-lifecycle half is ported here). Only the
// module wiring changed: legacy built one global EC2.map inside an IIFE
// that ran once at page load; here the single MapLibre instance lives in a
// ref owned by this component, constructed once on mount via useEffect and
// provided to descendants through MapContext instead of a global.
//
// React 18 StrictMode double-invokes effects in dev (mount, cleanup,
// mount again) to surface unsafe effects. Construction is guarded by
// checking mapRef.current first so a second map is never built while a
// first one is still live.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildStyle } from './style'
import { droneIconImage, trackIconImage } from './icons'
import { MapContext } from './MapContext'
import { useBasemap } from './useBasemap'
import { useOffline } from './useOffline'
import './map.css'

const UAE_CENTER: [number, number] = [54.6, 24.3]

// Exported so a test can pin them: these defaults ARE the console's globe
// entry camera, and the planner passing its own must not disturb them.
export const MAP_VIEW_DEFAULTS = { center: UAE_CENTER, zoom: 1.4 } as const

export interface MapViewProps {
  children?: ReactNode
  initialCenter?: [number, number]
  initialZoom?: number
  styleSpec?: StyleSpecification
  // False for consumers that manage their own basemap. The planner does
  // (usePlannerBasemap), and must: useBasemap drives operational-layer
  // visibility off the console's `scene`, which would strip the planner's
  // uae-places/uae-roads cartography. See useBasemap's `enabled` comment.
  manageBasemap?: boolean
}

export default function MapView({
  children,
  initialCenter = MAP_VIEW_DEFAULTS.center,
  initialZoom = MAP_VIEW_DEFAULTS.zoom,
  styleSpec,
  manageBasemap = true,
}: MapViewProps) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(
    () => {
      if (mapRef.current || !containerRef.current) return

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: styleSpec ?? buildStyle(),
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        // Shift+drag box-zoom is off by design: manual control (a later task)
        // uses shift+click on the map to queue a waypoint, and MapLibre's
        // default box-zoom handler would otherwise swallow that gesture
        // before it ever becomes a normal 'click' event.
        boxZoom: false,
      })
      mapRef.current = map

      // Tile attribution: attributionControl:false above just suppresses
      // MapLibre's default (unstyled, bright) control so a themed compact one
      // can be added instead — CARTO/Esri both require attribution per their
      // terms, and .maplibregl-ctrl-attrib is restyled in map.css to sit
      // quietly bottom-right instead of a bright white box.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

      map.on('load', () => {
        if (!map.hasImage('drone-triangle')) map.addImage('drone-triangle', droneIconImage())
        if (!map.hasImage('track-diamond')) map.addImage('track-diamond', trackIconImage('#fbbf24'))
        if (!map.hasImage('track-diamond-dim')) {
          map.addImage('track-diamond-dim', trackIconImage('#8b93a3'))
        }
        setReady(true)
      })

      return () => {
        // Order matters. React runs a component's effect cleanups in the order
        // the effects were declared, so this one runs BEFORE useBasemap's and
        // useOffline's below — and any of them (plus a camera animation still
        // in flight from useFollowDriver/selectEntity) can still reach for the
        // map after it is torn down. Publishing null first means every
        // `mapRef.current` guard in the codebase reads "no map" from this
        // point on, and map.stop() cancels an in-flight easeTo/flyTo so
        // MapLibre isn't mid-frame when remove() pulls its style out from
        // under it (the source of a "cannot read getSource of undefined"
        // throw from inside MapLibre on route navigation away from /console).
        mapRef.current = null
        setReady(false)
        map.stop()
        map.remove()
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps -- construction is
    // intentionally once-per-mount; the props are read as initial values only,
    // matching MapLibre's own constructor semantics. Re-running on a prop
    // change would build a second map.
  )

  useBasemap(mapRef, ready, manageBasemap)
  useOffline(mapRef)

  const contextValue = useMemo(() => ({ mapRef, ready }), [ready])

  return (
    <MapContext.Provider value={contextValue}>
      <div id="map" ref={containerRef} />
      {ready ? children : null}
    </MapContext.Provider>
  )
}
