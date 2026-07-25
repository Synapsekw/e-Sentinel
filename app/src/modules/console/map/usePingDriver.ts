// Ported (Phase 1B / Task 5) verbatim from assets/js/ui/map.js:395-398 (the
// FX_PULSE_* constants + the module-scoped `fxPulses` array) and :458-512
// (startPingDriver). Only the module wiring changed: legacy ran this as a
// single rAF loop started unconditionally at EC2.initMap() time, reading
// EC2.map / EC2.state.scene off globals; here it's a hook whose effect
// starts the rAF loop once the map is ready and cancels it on cleanup,
// reading the map via useMap() and the scene fresh every frame via
// useAppStore.getState() (matching legacy's tick, which also re-read
// EC2.state.scene directly rather than subscribing).
//
// `fxPulses` stays a plain module-scoped array (matching legacy) rather
// than React state: FX pulses are queued by imperative dock-launch code —
// Phase 1C's live engine binding pushes onto this array when a drone
// launches — and drained by the animation loop itself every frame, never by
// a render.
//
// FX_PULSE_* / fxPulses moved to ./fx (Phase 1C / Task 2) so the live-engine
// binding's launch-pulse push (fx.ts's pushLaunchPulse) and this driver's
// drain/prune share the same array without either file depending on the
// other. Imported below instead of declared locally; no other behavior
// change.

import { useEffect } from 'react'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { GeoJSONSource, Source } from 'maplibre-gl'
import { useMap } from './MapContext'
import { useAppStore } from '@/shared/store'
import { fxPulses, FX_PULSE_LIFE_MS, FX_PULSE_RINGS, FX_PULSE_STAGGER_MS } from './fx'

const PERIOD_MS = 1600
const TRACK_PING_PERIOD_MS = 2200 // slower than the dock ping: attention, not alarm

function emptyFC(): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: [] }
}

// A `Source` returned by `getSource()` doesn't carry `setData` in its public
// type (only `GeoJSONSource` does); narrow with an `in` check rather than a
// blind cast so a non-geojson source id would fail loudly instead of
// silently no-op-ing.
function asGeoJSONSource(source: Source | undefined): GeoJSONSource | null {
  return source && 'setData' in source ? (source as GeoJSONSource) : null
}

// Subtle pulsing ring around any dock with an outbound drone, or the
// currently selected dock (paint-only), plus launch-pulse FX ring bursts
// (tiny fx source rebuilt only while pulses are live). Single rAF driver,
// started once the map is ready and cancelled on unmount.
export function usePingDriver(): void {
  const { mapRef, ready } = useMap()

  useEffect(() => {
    if (!ready) return
    // Captured once per effect run (not re-read from mapRef.current every
    // frame like legacy re-reads the EC2.map global): intentional
    // divergence — MapView never replaces a live map instance out from
    // under a mounted tree, and this effect's cleanup cancels the rAF
    // whenever mapRef's identity would change (dep array below), so a
    // stale closed-over `map` can't outlive its own tick loop.
    const map = mapRef.current
    if (!map) return

    let fxActive = false
    let rafId: number | null = null

    function tick(ts: number): void {
      rafId = requestAnimationFrame(tick)
      if (!map || !map.getLayer('docks-rings') || useAppStore.getState().scene !== 'console') return

      const phase = (ts % PERIOD_MS) / PERIOD_MS
      const radius = 9 + phase * 7 // 9 -> 16
      const opacity = 0.45 * (1 - phase) // fades out
      const cond = ['any', ['==', ['get', 'state'], 'drone-away'], ['get', 'selected']]
      map.setPaintProperty('docks-rings', 'circle-radius', ['case', cond, radius, 0])
      map.setPaintProperty('docks-rings', 'circle-opacity', ['case', cond, opacity, 0])

      // Active-track attention pulse: paint-only, like the dock ping — the
      // layer's own filter already restricts it to status 'active' tracks.
      if (map.getLayer('tracks-ping')) {
        const tPhase = (ts % TRACK_PING_PERIOD_MS) / TRACK_PING_PERIOD_MS
        map.setPaintProperty('tracks-ping', 'circle-radius', 8 + tPhase * 14) // 8 -> 22
        map.setPaintProperty('tracks-ping', 'circle-stroke-opacity', 0.45 * (1 - tPhase))
      }

      const fxSrc = asGeoJSONSource(map.getSource('fx'))
      if (!fxSrc) return
      if (fxPulses.length) {
        const features: Feature<Point>[] = []
        for (let i = fxPulses.length - 1; i >= 0; i--) {
          const pulse = fxPulses[i]
          const age = ts - pulse.start
          if (age > FX_PULSE_LIFE_MS + FX_PULSE_STAGGER_MS * (FX_PULSE_RINGS - 1)) {
            fxPulses.splice(i, 1)
            continue
          }
          for (let r = 0; r < FX_PULSE_RINGS; r++) {
            const t = (age - r * FX_PULSE_STAGGER_MS) / FX_PULSE_LIFE_MS
            if (t < 0 || t > 1) continue
            features.push({
              type: 'Feature',
              properties: { r: 6 + t * 30, o: 0.55 * (1 - t) },
              geometry: { type: 'Point', coordinates: pulse.coords },
            })
          }
        }
        fxSrc.setData({ type: 'FeatureCollection', features })
        fxActive = true
      } else if (fxActive) {
        fxSrc.setData(emptyFC())
        fxActive = false
      }
    }

    rafId = requestAnimationFrame(tick)

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      rafId = null
    }
  }, [ready, mapRef])
}
