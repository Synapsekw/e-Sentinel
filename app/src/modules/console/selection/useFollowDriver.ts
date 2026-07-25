// Ported (Phase 1D / Task 3) from assets/js/ui/panels.js:2440-2449
// (startFollowDriver). Legacy started this once, unconditionally, at init
// time as a single page-lifetime setInterval reading EC2.followDroneId /
// EC2.map / window.__engine off globals. The React port scopes it to a
// hook whose effect starts the interval once the map is ready and clears
// it on cleanup, reading the map via useMap() and the engine via
// useEngine(), and the live followDroneId fresh on every tick via
// useAppStore.getState() (matching legacy's tick, which also re-read
// EC2.followDroneId directly off the global rather than subscribing).

import { useEffect } from 'react'
import { useMap } from '@/modules/console/map/MapContext'
import { useEngine } from '@/modules/console/engine/EngineContext'
import { useAppStore } from '@/shared/store'

const FOLLOW_INTERVAL_MS = 1000
const FOLLOW_ZOOM = 12.5
const FOLLOW_DURATION_MS = 950

export function useFollowDriver(): void {
  const { mapRef, ready } = useMap()
  const { engineRef } = useEngine()

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const id = setInterval(() => {
      const { followDroneId, setFollowDroneId } = useAppStore.getState()
      const engine = engineRef.current
      if (!followDroneId || !engine) return
      const drone = engine.drones.get(followDroneId)
      if (!drone || drone.state === 'docked') {
        // A landed or missing drone can no longer be followed.
        setFollowDroneId(null)
        return
      }
      map.easeTo({ center: drone.pos, zoom: FOLLOW_ZOOM, duration: FOLLOW_DURATION_MS })
    }, FOLLOW_INTERVAL_MS)

    return () => clearInterval(id)
  }, [ready, mapRef, engineRef])
}
