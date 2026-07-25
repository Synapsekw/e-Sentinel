// Ported (Phase 1E / Task 8) from assets/js/ui/control.js:685-701
// (wireMapClicks). Legacy registered ONE map-wide 'click' listener that ran
// before/alongside the layer-scoped selection handlers in panels.js and
// routed by control.mode: a wizard click captures a route point, a manual
// click issues a goto (or a queue on shift-click), and 'normal' falls
// through to the ordinary selection handlers. The React port keeps exactly
// that split: the layer-scoped handlers live in
// selection/useMapSelection.ts and already bail on inCaptureMode(), so this
// hook only has to handle the two capture modes.
//
// Note the ordering guarantee legacy relied on and this preserves: a
// layer-scoped MapLibre handler and a map-wide one both fire for the same
// click, so the inCaptureMode() bail in useMapSelection is what stops a
// wizard/manual click from ALSO changing the selection. Nothing here needs
// to stopPropagation.

import { useEffect } from 'react'
import { useMap } from '@/modules/console/map/MapContext'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { useContext } from 'react'
import { useAppStore } from '@/shared/store'
import type { LonLat } from '@/modules/console/domain'

export interface UseCaptureMapClicksOptions {
  // Applies a step-2 wizard click. Supplied by the caller (Console.tsx)
  // rather than imported, so this hook has no cycle with useWizard.
  onWizardClick: (lonlat: LonLat) => void
}

export function useCaptureMapClicks({ onWizardClick }: UseCaptureMapClicksOptions): void {
  const { mapRef, ready } = useMap()
  const engineCtx = useContext(EngineContext)

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const lonlat: LonLat = [e.lngLat.lng, e.lngLat.lat]
      const mode = useAppStore.getState().controlMode

      if (mode === 'wizard') {
        onWizardClick(lonlat)
        return
      }

      const activeId = useAppStore.getState().controlActiveId
      const engine = engineCtx ? engineCtx.engineRef.current : null
      if (mode !== 'manual' || !activeId || !engine) return

      // control.js:694-698 — shift-click queues a waypoint behind the
      // current target, a plain click retargets immediately.
      if (e.originalEvent.shiftKey) engine.manualQueue(activeId, lonlat)
      else engine.manualGoto(activeId, lonlat)
    }

    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [mapRef, ready, engineCtx, onWizardClick])
}
