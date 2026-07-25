// Ported (Phase 1D / Task 3) from assets/js/ui/panels.js:2636-2699
// (wireMapDockInteractions). Legacy wired these listeners once at
// EC2.initMap() time, reading EC2.map / EC2.select off globals. The React
// port scopes them to a hook whose effect (re)registers every listener once
// the map is ready and removes every one of them on cleanup — matching
// usePingDriver.ts's / useLiveLayers.ts's ready-gated effect-with-cleanup
// shape, and satisfying the plan's "every listener removed via map.off on
// cleanup" constraint that legacy (a page-lifetime singleton) never needed.

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useMap } from '@/modules/console/map/MapContext'
import { useEngine } from '@/modules/console/engine/EngineContext'
import { selectEntity, inCaptureMode } from './selectEntity'

// panels.js:2679's DOT_LAYERS: the precise dot/drone click handlers below
// always win when a click actually lands on one of them; coverage-fill's
// forgiving-click handlers only fill in the open ring area between dots.
const DOT_LAYERS = ['docks-dots', 'sites-dots', 'drones-layer']

// GeoJSON feature properties are typed `{[name: string]: any}` by
// maplibre-gl; narrow through `unknown` here so every read below is a
// checked read rather than an unsafe `any` flow.
function propString(
  properties: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!properties) return undefined
  const v = properties[key]
  return typeof v === 'string' ? v : undefined
}

function setCursor(map: maplibregl.Map, cursor: string): void {
  map.getCanvas().style.cursor = cursor
}

export function useMapSelection(): void {
  const { mapRef, ready } = useMap()
  const { engineRef } = useEngine()

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    // panels.js:2641-2646: click a dock dot -> select that dock.
    const onDockClick = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return
      const f = e.features && e.features[0]
      const id = propString(f?.properties, 'id')
      if (!id) return
      selectEntity({ type: 'dock', id }, engineRef.current, map)
    }
    // panels.js:2655-2660: click an airborne drone triangle -> select the
    // drone. Camera stays put here; FOLLOW (useFollowDriver.ts), if
    // toggled on, drives the camera instead.
    const onDroneClick = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return
      const f = e.features && e.features[0]
      const id = propString(f?.properties, 'id')
      if (!id) return
      selectEntity({ type: 'drone', id }, engineRef.current, map)
    }
    // panels.js:2665-2670: click a live tower site -> select the site.
    const onSiteClick = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return
      const f = e.features && e.features[0]
      const id = propString(f?.properties, 'id')
      if (!id) return
      selectEntity({ type: 'site', id }, engineRef.current, map)
    }
    const onPointerEnter = (): void => {
      if (!inCaptureMode()) setCursor(map, 'pointer')
    }
    const onPointerLeave = (): void => {
      if (!inCaptureMode()) setCursor(map, '')
    }

    // panels.js:2672-2698: coverage rings as a big, forgiving click target.
    // A dock/site dot is only a few px wide, so a click anywhere inside a
    // location's coverage circle selects that location too. The precise
    // dot/drone handlers above still win when the click actually lands on
    // one of them (bail here if any is under the cursor); a site ring is
    // preferred over a dock ring beneath it.
    const onCoverageClick = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return
      const onDot = map.queryRenderedFeatures(e.point, {
        layers: DOT_LAYERS.filter((id) => !!map.getLayer(id)),
      })
      if (onDot.length) return // let the precise dot handler take it
      const feats = e.features || []
      const pick = feats.find((f) => propString(f.properties, 'kind') === 'site') || feats[0]
      if (!pick) return
      const id = propString(pick.properties, 'id')
      if (!id) return
      if (propString(pick.properties, 'kind') === 'site') {
        selectEntity({ type: 'site', id }, engineRef.current, map)
      } else {
        selectEntity({ type: 'dock', id }, engineRef.current, map)
      }
    }
    const onCoverageMove = (e: maplibregl.MapLayerMouseEvent): void => {
      if (inCaptureMode()) return
      // Don't fight the dot handlers' pointer; only assert it over open
      // ring area.
      const onDot = map.queryRenderedFeatures(e.point, {
        layers: DOT_LAYERS.filter((id) => !!map.getLayer(id)),
      })
      if (!onDot.length) setCursor(map, 'pointer')
    }
    const onCoverageLeave = (): void => {
      if (!inCaptureMode()) setCursor(map, '')
    }

    map.on('click', 'docks-dots', onDockClick)
    map.on('mouseenter', 'docks-dots', onPointerEnter)
    map.on('mouseleave', 'docks-dots', onPointerLeave)

    map.on('click', 'drones-layer', onDroneClick)
    map.on('mouseenter', 'drones-layer', onPointerEnter)
    map.on('mouseleave', 'drones-layer', onPointerLeave)

    map.on('click', 'sites-dots', onSiteClick)
    map.on('mouseenter', 'sites-dots', onPointerEnter)
    map.on('mouseleave', 'sites-dots', onPointerLeave)

    map.on('click', 'coverage-fill', onCoverageClick)
    map.on('mousemove', 'coverage-fill', onCoverageMove)
    map.on('mouseleave', 'coverage-fill', onCoverageLeave)

    return () => {
      map.off('click', 'docks-dots', onDockClick)
      map.off('mouseenter', 'docks-dots', onPointerEnter)
      map.off('mouseleave', 'docks-dots', onPointerLeave)

      map.off('click', 'drones-layer', onDroneClick)
      map.off('mouseenter', 'drones-layer', onPointerEnter)
      map.off('mouseleave', 'drones-layer', onPointerLeave)

      map.off('click', 'sites-dots', onSiteClick)
      map.off('mouseenter', 'sites-dots', onPointerEnter)
      map.off('mouseleave', 'sites-dots', onPointerLeave)

      map.off('click', 'coverage-fill', onCoverageClick)
      map.off('mousemove', 'coverage-fill', onCoverageMove)
      map.off('mouseleave', 'coverage-fill', onCoverageLeave)
    }
  }, [ready, mapRef, engineRef])
}
