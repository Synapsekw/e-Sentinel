// Ported (Phase 1B / Task 4) from assets/js/ui/globe.js: measureGlobeRadiusPx
// /fitOrbitZoom (:52-82), onViewportResize (:84-93), updateAltReadout
// (:108-113), animateBeaconPing (:115-121), beaconVisible/updateBeaconTag
// (:123-148), the tick rAF loop (:171-196, rotation now driven by the pure
// `nextGlobeCenter` from globeMath.ts), addBeaconLayers (:198-222),
// wirePointerPause/wireClicks (:224-241), enterTheater/exitToOrbit
// (:259-287), setBeaconVisible (:292-296), and initGlobe's boot sequence
// (:298-326). Only the module wiring changed: legacy's module-level `let`
// variables (dragging, resumeAt, diving, diveDir, lastTs, ...) become one
// mutable ref object so they survive across renders without retriggering
// effects; the DOM lookups for #uae-beacon-tag/#g-alt become the tagRef/
// altRef passed in by the caller (GlobeOverlay owns the actual elements);
// EC2.state.scene/EC2.onSceneChange become the Zustand store; and
// EC2.enterTheater/EC2.exitToOrbit become this hook's returned callbacks.
// The persistent ENTER THEATER button (buildEnterButton, :247-257) is
// dropped here — GlobeOverlay renders it directly as JSX, visible
// declaratively whenever scene === 'globe'.

import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useMap } from '../map/MapContext'
import { useAppStore } from '@/shared/store'
import {
  ORBIT,
  THEATER,
  BEACON,
  DIVE_MS,
  DIVE_CURVE,
  IDLE_RESUME_MS,
  GLOBE_FIT_FRACTION,
  TAG_HIT_PX,
  INTRO_LNG_OFFSET,
  altKmFromZoom,
  fmtAlt,
  shortestLngDelta,
  nextGlobeCenter,
} from './globeMath'

export interface UseGlobeOptions {
  tagRef: MutableRefObject<HTMLElement | null>
  altRef: MutableRefObject<HTMLElement | null>
}

export interface UseGlobeResult {
  enterTheater: () => void
  exitToOrbit: () => void
}

interface GlobeRuntimeState {
  dragging: boolean
  resumeAt: number
  diving: boolean
  diveDir: 'in' | 'out' | null
  lastTs: number | null
  lastSizeCheckTs: number
  orbitFitDirty: boolean
  orbitZoom: number
  rafId: number | null
}

function measureGlobeRadiusPx(map: maplibregl.Map): number {
  const c = map.getCenter()
  const ctr = map.project([c.lng, c.lat])
  if (!isFinite(ctr.x) || !isFinite(ctr.y)) return 0
  let maxD = 0
  for (let a = 50; a <= 130; a += 2) {
    const p = map.project([c.lng + a, c.lat])
    const d = Math.hypot(p.x - ctr.x, p.y - ctr.y)
    if (isFinite(d) && d > maxD) maxD = d
  }
  return maxD
}

function fitOrbitZoom(map: maplibregl.Map): number {
  const cont = map.getContainer()
  const w = cont.clientWidth || window.innerWidth || 1280
  const h = cont.clientHeight || window.innerHeight || 800
  const targetR = GLOBE_FIT_FRACTION * 0.5 * Math.min(w, h)
  const restoreZoom = map.getZoom()
  let z = ORBIT.zoom
  for (let i = 0; i < 6; i++) {
    map.setZoom(z)
    const r = measureGlobeRadiusPx(map)
    if (!(r > 0)) break
    const err = Math.log2(targetR / r)
    z = Math.min(3.2, Math.max(0.2, z + err))
    if (Math.abs(err) < 0.01) break
  }
  map.setZoom(restoreZoom)
  return z
}

function beaconVisible(map: maplibregl.Map): {
  visible: boolean
  screen: { x: number; y: number }
} {
  const screen = map.project(BEACON)
  const canvas = map.getCanvas()
  if (!isFinite(screen.x) || !isFinite(screen.y)) return { visible: false, screen }
  if (
    screen.x < 0 ||
    screen.y < 0 ||
    screen.x > canvas.clientWidth ||
    screen.y > canvas.clientHeight
  ) {
    return { visible: false, screen }
  }
  const back = map.unproject(screen)
  // Wrap-safe longitude distance: unproject can hand back an equivalent
  // longitude on another world copy, which would otherwise fail the
  // roundtrip test and suppress the tag even with the beacon front-and-center.
  const dLng = Math.abs(shortestLngDelta(back.lng, BEACON[0]))
  const dist = Math.hypot(dLng, back.lat - BEACON[1])
  return { visible: dist <= 1, screen }
}

// Runs the orbital globe: viewport-fitted orbit zoom, homing rotation,
// beacon ping/tag, alt readout, and the dive-to-theater / return-to-orbit
// transitions. Must be called from a component rendered inside <MapView>.
export function useGlobe({ tagRef, altRef }: UseGlobeOptions): UseGlobeResult {
  const { mapRef, ready } = useMap()

  const rt = useRef<GlobeRuntimeState>({
    dragging: false,
    resumeAt: 0,
    diving: false,
    diveDir: null,
    lastTs: null,
    lastSizeCheckTs: 0,
    orbitFitDirty: false,
    orbitZoom: ORBIT.zoom,
    rafId: null,
  })

  const updateAltReadout = useCallback(
    (map: maplibregl.Map) => {
      const altEl = altRef.current
      if (!altEl) return
      const km = altKmFromZoom(map.getZoom(), rt.current.orbitZoom, THEATER.zoom)
      const label = rt.current.diving
        ? rt.current.diveDir === 'in'
          ? 'DESCENDING'
          : 'ASCENDING'
        : 'ORBITAL'
      altEl.textContent = 'ALT ' + fmtAlt(km) + ' KM · ' + label
    },
    [altRef],
  )

  // Always-available entry point: dive from the orbital globe into the
  // theater map. Guards against re-entry mid-flight and outside the globe
  // scene, same as legacy's EC2.enterTheater.
  const enterTheater = useCallback(() => {
    const map = mapRef.current
    const s = rt.current
    if (!map || useAppStore.getState().scene !== 'globe' || s.diving) return
    s.diving = true
    s.diveDir = 'in'
    if (tagRef.current) tagRef.current.hidden = true
    map.flyTo({ center: THEATER.center, zoom: THEATER.zoom, duration: DIVE_MS, curve: DIVE_CURVE })
    // `once(type, listener)` always returns `this` at runtime, never the
    // Promise from its listener-less overload; `void` discards the union
    // return type the two overloads share.
    void map.once('moveend', () => {
      s.diving = false
      s.diveDir = null
      useAppStore.getState().setScene('console')
    })
  }, [mapRef, tagRef])

  const exitToOrbit = useCallback(() => {
    const map = mapRef.current
    const s = rt.current
    if (!map || useAppStore.getState().scene !== 'console' || s.diving) return
    s.diving = true
    s.diveDir = 'out'
    s.resumeAt = 0 // stay paused for the duration of the return flight
    if (s.orbitFitDirty) {
      s.orbitZoom = fitOrbitZoom(map)
      s.orbitFitDirty = false
    }
    map.flyTo({ center: ORBIT.center, zoom: s.orbitZoom, duration: DIVE_MS, curve: DIVE_CURVE })
    void map.once('moveend', () => {
      s.diving = false
      s.diveDir = null
      useAppStore.getState().setScene('globe')
      s.resumeAt = performance.now() + IDLE_RESUME_MS
      updateAltReadout(map)
    })
  }, [mapRef, updateAltReadout])

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return
    const s = rt.current

    function onViewportResize(): void {
      if (!map) return
      map.resize() // canvas may lag the container
      if (useAppStore.getState().scene === 'globe' && !s.diving) {
        s.orbitZoom = fitOrbitZoom(map)
        map.setZoom(s.orbitZoom)
        s.orbitFitDirty = false
      } else {
        s.orbitFitDirty = true // re-fit on the way back to orbit
      }
    }

    function animateBeaconPing(ts: number): void {
      if (!map || !map.getLayer('beacon-ping')) return
      const period = 1800
      const phase = (ts % period) / period
      map.setPaintProperty('beacon-ping', 'circle-radius', 6 + phase * 22)
      map.setPaintProperty('beacon-ping', 'circle-stroke-opacity', (1 - phase) * 0.7)
    }

    function updateBeaconTag(): void {
      const tagEl = tagRef.current
      if (!map || !tagEl) return
      const { visible, screen } = beaconVisible(map)
      if (visible && !s.diving) {
        tagEl.hidden = false
        tagEl.style.left = Math.round(screen.x + 16) + 'px'
        tagEl.style.top = Math.round(screen.y) + 'px'
      } else {
        tagEl.hidden = true
      }
    }

    function rotateStep(dt: number): void {
      if (!map) return
      const c = map.getCenter()
      const next = nextGlobeCenter({ lng: c.lng, lat: c.lat }, BEACON, ORBIT.center[1], dt)
      if (!next.settled) map.setCenter([next.lng, next.lat])
    }

    function tick(ts: number): void {
      if (s.lastTs == null) s.lastTs = ts
      const dt = Math.min((ts - s.lastTs) / 1000, 0.25) // clamp so a hidden tab can't snap-jump
      s.lastTs = ts

      // Belt-and-suspenders canvas size check (cheap, ~2x/sec): recovers
      // from any missed resize that would leave the globe in a small
      // top-left canvas.
      if (map && ts - s.lastSizeCheckTs > 500) {
        s.lastSizeCheckTs = ts
        const cont = map.getContainer()
        const cv = map.getCanvas()
        if (cv.clientWidth !== cont.clientWidth || cv.clientHeight !== cont.clientHeight)
          onViewportResize()
      }

      if (useAppStore.getState().scene === 'globe') {
        if (!s.diving && !s.dragging && performance.now() >= s.resumeAt) rotateStep(dt)
        animateBeaconPing(ts)
        updateBeaconTag()
      }
      if (s.diving && map) updateAltReadout(map)

      s.rafId = requestAnimationFrame(tick)
    }

    function addBeaconLayers(): void {
      if (!map) return
      if (!map.getSource('beacon')) {
        map.addSource('beacon', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: BEACON },
          },
        })
      }
      if (!map.getLayer('beacon-ping')) {
        map.addLayer({
          id: 'beacon-ping',
          type: 'circle',
          source: 'beacon',
          paint: {
            'circle-radius': 6,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#ff5a5a',
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.7,
          },
        })
      }
      if (!map.getLayer('beacon-dot')) {
        map.addLayer({
          id: 'beacon-dot',
          type: 'circle',
          source: 'beacon',
          paint: {
            'circle-radius': 3.5,
            'circle-color': '#ff5a5a',
            'circle-stroke-color': '#0a0b0e',
            'circle-stroke-width': 1,
          },
        })
      }
    }

    function setBeaconVisible(visible: boolean): void {
      if (!map) return
      const vis = visible ? 'visible' : 'none'
      if (map.getLayer('beacon-ping')) map.setLayoutProperty('beacon-ping', 'visibility', vis)
      if (map.getLayer('beacon-dot')) map.setLayoutProperty('beacon-dot', 'visibility', vis)
    }

    const onPointerDown = () => {
      s.dragging = true
      s.resumeAt = 0
    }
    const onPointerUp = () => {
      if (!s.dragging) return
      s.dragging = false
      s.resumeAt = performance.now() + IDLE_RESUME_MS
    }

    const onMapClick = (e: { point: { x: number; y: number } }) => {
      if (!map || useAppStore.getState().scene !== 'globe' || s.diving) return
      const screen = map.project(BEACON)
      if (Math.hypot(e.point.x - screen.x, e.point.y - screen.y) <= TAG_HIT_PX) enterTheater()
    }

    const onTagClick = () => enterTheater()

    // ---- boot (globe.js:298-326) ----
    map.resize() // sync canvas to container before any fit math
    s.orbitZoom = fitOrbitZoom(map)
    // Boot with the center meridian east of the UAE: the opening shot
    // rotates westward until the beacon settles front-and-center.
    map.jumpTo({ center: [BEACON[0] + INTRO_LNG_OFFSET, ORBIT.center[1]], zoom: s.orbitZoom })
    window.addEventListener('resize', onViewportResize)

    addBeaconLayers()

    const canvas = map.getCanvas()
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    map.on('click', onMapClick)
    tagRef.current?.addEventListener('click', onTagClick)

    s.resumeAt = performance.now() + IDLE_RESUME_MS
    s.lastTs = null
    s.rafId = requestAnimationFrame(tick)

    // Subscribe once; honor initial state (scene is 'globe' at boot, so the
    // beacon starts visible, matching the layer default set above).
    let prevScene = useAppStore.getState().scene
    setBeaconVisible(prevScene !== 'console')
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.scene !== prevScene) {
        prevScene = state.scene
        setBeaconVisible(state.scene !== 'console')
      }
    })

    const tagEl = tagRef.current

    return () => {
      if (s.rafId != null) cancelAnimationFrame(s.rafId)
      s.rafId = null
      window.removeEventListener('resize', onViewportResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      map.off('click', onMapClick)
      tagEl?.removeEventListener('click', onTagClick)
      unsubscribe()
    }
  }, [ready, mapRef, tagRef, altRef, enterTheater, updateAltReadout])

  return { enterTheater, exitToOrbit }
}
