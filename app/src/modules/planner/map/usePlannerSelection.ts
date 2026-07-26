// Map-click selection for the planner, the counterpart to the console's
// selection/useMapSelection.ts. Read that file alongside this one: the
// conventions here -- layer-scoped map.on, checked property reads, a pointer
// cursor on hover, and treating the coverage ring as a large forgiving click
// target because a 5px marker is not one -- are all its, deliberately, so the
// two modules answer a click the same way.
//
// What differs: this writes to the planner's own store (usePlanStore.select)
// rather than going through selectEntity, and it has no camera behaviour. A
// planner user is placing infrastructure on a map they are already looking at;
// flying the camera on every click would fight them.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { usePlanStore } from '../store/planStore'

const DOCK_LAYER = 'planner-docks-circle'
const RING_LAYER = 'planner-rings-fill'
const AOI_LAYER = 'planner-aoi-fill'

// Every planner feature a click can land on, for the bare-map handler's
// "did this click hit anything?" probe.
const HIT_LAYERS = [DOCK_LAYER, RING_LAYER, AOI_LAYER]

// A drag under this many pixels is a click with a shaky hand, not a drag.
// MapLibre's own click-vs-drag threshold is in the same range.
const DRAG_SLOP_PX = 3

// maplibre-gl types feature properties as `{[name: string]: any}`; narrow
// through `unknown` so every read is checked rather than an unsafe `any` flow
// (same helper, same reasoning, as useMapSelection's).
function propString(
  properties: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!properties) return undefined
  const v = properties[key]
  return typeof v === 'string' ? v : undefined
}

function firstId(e: maplibregl.MapLayerMouseEvent): string | undefined {
  return propString(e.features?.[0]?.properties, 'id')
}

// `enabled` is PlannerShell's `drawMode === 'idle' && !placing`. Selection is
// the fourth gesture competing for a click on this map, after draw vertices,
// armed dock placement and dock dragging; the other three already coexist
// through this same gate (see useDockPlacement's drawModeIdle comments), so
// selection takes it too rather than adding handlers that fight for the click.
export function usePlannerSelection(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !enabled || !isMapUsable(map)) return

    // Drag suppression. useDockPlacement commits a dock drag on mouseup, and
    // MapLibre then fires a click at the release point -- which, for a drag
    // that started on a marker, lands on that same marker. Selecting there
    // would mean every drag also re-selected its dock. Tracked here rather
    // than shared with useDockPlacement: this hook must make its own decision
    // even when nothing is being dragged (a plain map pan also ends in a
    // click), and coupling the two hooks through shared mutable state would
    // be worse than each reading the pointer for itself.
    let downAt: { x: number; y: number } | null = null
    let suppressNextClick = false

    const onDown = (e: maplibregl.MapMouseEvent) => {
      downAt = { x: e.point.x, y: e.point.y }
    }
    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!downAt) return
      const dx = e.point.x - downAt.x
      const dy = e.point.y - downAt.y
      suppressNextClick = Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX
      downAt = null
    }

    // Consumes the suppression flag: every click path calls this first, so a
    // suppressed click is swallowed exactly once and the next real click is
    // unaffected.
    const claimClick = (): boolean => {
      if (!suppressNextClick) return true
      suppressNextClick = false
      return false
    }

    const select = (sel: { type: 'aoi' | 'dock'; id: string }) => {
      usePlanStore.getState().select(sel)
    }

    const onDockClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'dock', id })
    }

    // The ring is the forgiving target: a dock marker is 5px wide, and the
    // console makes the same call for the same reason. Stands down when the
    // click also landed on a marker, so the precise handler above takes it and
    // one click never selects twice.
    const onRingClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: [DOCK_LAYER] }).length) return
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'dock', id })
    }

    // Docks and their rings both win over the area beneath them: the specific
    // target beats the general one, the same precedence useMapSelection
    // applies between dots and coverage.
    const onAoiClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: [DOCK_LAYER, RING_LAYER] }).length) return
      if (!claimClick()) return
      const id = firstId(e)
      if (id) select({ type: 'aoi', id })
    }

    // Clicking bare map clears, the console's convention (its OPS button and
    // clearSelection do the same job). Probes for a hit first: MapLibre
    // dispatches the layer-scoped handlers above AND this one for the same
    // click, so without the probe every selection would be cleared immediately
    // after being made.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const present = HIT_LAYERS.filter((id) => !!map.getLayer(id))
      if (present.length && map.queryRenderedFeatures(e.point, { layers: present }).length) return
      if (!claimClick()) return
      usePlanStore.getState().select(null)
    }

    const setCursor = (cursor: string) => {
      map.getCanvas().style.cursor = cursor
    }
    const onEnter = () => setCursor('pointer')
    const onLeave = () => setCursor('')

    map.on('mousedown', onDown)
    map.on('mouseup', onUp)
    map.on('click', onMapClick)
    map.on('click', DOCK_LAYER, onDockClick)
    map.on('click', RING_LAYER, onRingClick)
    map.on('click', AOI_LAYER, onAoiClick)
    for (const layer of HIT_LAYERS) {
      map.on('mouseenter', layer, onEnter)
      map.on('mouseleave', layer, onLeave)
    }

    return () => {
      // Captured `map`, not mapRef.current: MapView's cleanup runs first on
      // route navigation and nulls the ref, so re-reading it here would only
      // ever see null. map.remove() nulls the instance's internal Style, which
      // is what isMapUsable detects. Same reasoning as useDockPlacement's and
      // useAoiDraw's cleanups.
      if (!isMapUsable(map)) return
      map.off('mousedown', onDown)
      map.off('mouseup', onUp)
      map.off('click', onMapClick)
      map.off('click', DOCK_LAYER, onDockClick)
      map.off('click', RING_LAYER, onRingClick)
      map.off('click', AOI_LAYER, onAoiClick)
      for (const layer of HIT_LAYERS) {
        map.off('mouseenter', layer, onEnter)
        map.off('mouseleave', layer, onLeave)
      }
      // Never leave a pointer cursor stranded on a map this hook no longer
      // manages.
      setCursor('')
    }
  }, [mapRef, ready, enabled])
}
