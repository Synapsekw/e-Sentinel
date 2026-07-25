// Ported (Phase 1B / Task 3) from assets/js/ui/map.js:940-964
// (initBasemapLoadingChip). Only the module wiring changed: legacy created
// the #basemap-loading div imperatively and appended it to document.body
// once at map-init time; here it's a React component reading the same
// sourcedataloading/idle events off the shared map instance (via useMap)
// and driving its own visibility state instead of toggling `.hidden` on a
// manually-created element. The 300ms debounce and the console-scene-only
// gate are transcribed as-is.

import { useEffect, useRef, useState } from 'react'
import { useMap } from './MapContext'
import { useAppStore } from '@/shared/store'

export default function BasemapChip() {
  const { mapRef, ready } = useMap()
  const [visible, setVisible] = useState(false)
  // Mirrors legacy's `chip.hidden`: the authoritative "is it showing right
  // now" flag, checked synchronously inside the event handlers below
  // (React state updates are not synchronous, so `visible` itself can't be
  // read reliably inside the same tick a handler fires).
  const chipVisibleRef = useRef(false)

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    let showTimer: ReturnType<typeof setTimeout> | null = null

    const onSourceDataLoading = (e: { sourceId?: string }) => {
      // Console scene only — the chip must never sit over the globe
      // cinematic (orbital satellite tiles load slowly on a cold cache).
      if (useAppStore.getState().scene !== 'console') return
      if (!e.sourceId || e.sourceId.indexOf('raster-') !== 0) return
      if (showTimer !== null || chipVisibleRef.current) return
      showTimer = setTimeout(() => {
        showTimer = null
        chipVisibleRef.current = true
        setVisible(true)
      }, 300)
    }

    const onIdle = () => {
      if (showTimer !== null) {
        clearTimeout(showTimer)
        showTimer = null
      }
      chipVisibleRef.current = false
      setVisible(false)
    }

    // DELIBERATE DIVERGENCE from legacy (map.js:960-963), which hid the chip
    // on 'idle' alone. 'idle' only fires once the map has nothing left to
    // render, and Phase 1C's render loop calls setData on the live sources
    // every single frame, so on this port the map is never idle and a chip
    // shown once would stay up forever. Hiding on the raster source's own
    // completion ('sourcedata' with isSourceLoaded) is the same signal
    // 'idle' was standing in for, without depending on the whole map going
    // quiet. 'idle' is kept as the belt-and-braces path (globe scene, where
    // the live layers are not being fed).
    const onSourceData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (!e.sourceId || e.sourceId.indexOf('raster-') !== 0) return
      if (!e.isSourceLoaded) return
      onIdle()
    }

    map.on('sourcedataloading', onSourceDataLoading)
    map.on('sourcedata', onSourceData)
    map.on('idle', onIdle)

    return () => {
      if (showTimer !== null) clearTimeout(showTimer)
      map.off('sourcedataloading', onSourceDataLoading)
      map.off('sourcedata', onSourceData)
      map.off('idle', onIdle)
    }
  }, [mapRef, ready])

  return (
    <div id="basemap-loading" hidden={!visible}>
      ACQUIRING BASEMAP
    </div>
  )
}
