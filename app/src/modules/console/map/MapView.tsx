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

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildStyle } from './style'
import { droneIconImage, trackIconImage } from './icons'
import { MapContext } from './MapContext'
import { useBasemap } from './useBasemap'
import { useOffline } from './useOffline'
import './map.css'

const UAE_CENTER: [number, number] = [54.6, 24.3]

export interface MapViewProps {
  children?: ReactNode
}

export default function MapView({ children }: MapViewProps) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: UAE_CENTER,
      zoom: 1.4,
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
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  useBasemap(mapRef, ready)
  useOffline(mapRef, ready)

  return (
    <MapContext.Provider value={{ mapRef, ready }}>
      <div id="map" ref={containerRef} />
      {ready ? children : null}
    </MapContext.Provider>
  )
}
