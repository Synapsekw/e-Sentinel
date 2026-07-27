// Route root. Composes the telemetry chrome around MapView and wires the
// map-bound hook from inside <TelemetryShell>, a child of <MapView>.
// MapView renders `{ready ? children : null}`, so the shell only mounts once
// the map's `load` event has fired -- the same arrangement Planner.tsx uses.

import { useEffect, useState } from 'react'
import MapView from '@/modules/console/map/MapView'
import { useMap } from '@/modules/console/map/MapContext'
import { useFlightLayers } from '../map/useFlightLayers'
import { buildTelemetryStyle } from '../map/telemetryStyle'
import { fetchCatalog } from '../io/catalogIo'
import { pathBounds } from '../domain/flightPath'
import { useTelemetryStore } from '../store/telemetryStore'
import TelemetryTopbar from './TelemetryTopbar'
import FlightLibrary from './FlightLibrary'
import FramePanel from './FramePanel'
import Scrubber from './Scrubber'
import { useFlightLoader } from './useFlightLoader'
import { usePlayback } from './usePlayback'
import './telemetry.css'

// The logs are Kuwaiti survey grids, not UAE operations (spec section 3.5),
// so there is no meaningful default camera. This frames the region the baked
// catalog sits in; opening a flight immediately fits to its real bounds.
const TELEMETRY_CENTER: [number, number] = [48.0, 28.78]
const TELEMETRY_ZOOM = 9

function TelemetryShell() {
  const { mapRef, ready } = useMap()
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)

  useFlightLayers(mapRef, ready, path, cursorT)

  // Fit to the opened flight. These are 790x710m survey boxes, so the fit
  // lands near z16 -- a regional camera would show a dot.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !path) return
    const bounds = pathBounds(path)
    if (bounds) map.fitBounds(bounds, { padding: 80, duration: 900 })
  }, [mapRef, ready, path])

  return null
}

export default function Telemetry() {
  const [style] = useState(buildTelemetryStyle)
  // Actions via getState(), not destructured/selected -- see the conventions
  // section: unbound-method trips on both a selector and a destructure.
  const { openFlight, openDroppedFile } = useFlightLoader()
  usePlayback()

  useEffect(() => {
    let alive = true
    void fetchCatalog(import.meta.env.BASE_URL).then((catalog) => {
      if (alive) useTelemetryStore.getState().setCatalog(catalog.flights)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <main className="tm-root">
      <MapView
        initialCenter={TELEMETRY_CENTER}
        initialZoom={TELEMETRY_ZOOM}
        styleSpec={style}
        manageBasemap={false}
      >
        <TelemetryShell />
      </MapView>
      <TelemetryTopbar onLoadFile={(file) => void openDroppedFile(file)} />
      <FlightLibrary onOpen={(meta) => void openFlight(meta)} />
      <FramePanel />
      <Scrubber />
    </main>
  )
}
