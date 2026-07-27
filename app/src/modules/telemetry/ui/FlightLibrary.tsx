// The flight library. Grouping is by aircraft serial rather than name
// because these logs come from two distinct airframes that share the name
// "Matrice 400" (spec section 3.2) -- grouping by name would merge them.

import { useMemo } from 'react'
import LibraryFilters from './LibraryFilters'
import { selectVisibleFlights, useTelemetryStore } from '../store/telemetryStore'
import { fmtDate, fmtDuration, fmtKm, fmtMeters } from '../domain/format'
import type { FlightMeta } from '../domain/types'
import './telemetry.css'

interface FlightLibraryProps {
  onOpen: (meta: FlightMeta) => void
}

interface AircraftGroup {
  sn: string
  name: string
  flights: FlightMeta[]
}

function groupBySerial(flights: FlightMeta[]): AircraftGroup[] {
  const groups: AircraftGroup[] = []
  for (const f of flights) {
    const existing = groups.find((g) => g.sn === f.aircraftSn)
    if (existing) existing.flights.push(f)
    else groups.push({ sn: f.aircraftSn, name: f.aircraftName, flights: [f] })
  }
  return groups
}

export default function FlightLibrary({ onOpen }: FlightLibraryProps) {
  // Four raw slices plus a memo, NOT a store method returning a fresh array:
  // see the note on selectVisibleFlights in the store.
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)
  const filters = useTelemetryStore((s) => s.filters)
  const sort = useTelemetryStore((s) => s.sort)
  const selectedId = useTelemetryStore((s) => s.selectedId)
  // Action via getState(), not a selector -- see the conventions section.

  const visible = useMemo(
    () => selectVisibleFlights({ catalog, sessionFlights, filters, sort }),
    [catalog, sessionFlights, filters, sort],
  )
  const sessionIds = sessionFlights.map((f) => f.id)
  const total = catalog.length + sessionFlights.length

  return (
    <aside className="tm-library">
      <LibraryFilters />
      {sessionFlights.length > 0 && (
        <button
          className="tm-btn"
          style={{ margin: '0 12px 8px' }}
          onClick={() => useTelemetryStore.getState().clearSessionFlights()}
        >
          CLEAR {sessionFlights.length} DROPPED
        </button>
      )}
      <div className="tm-list">
        {total === 0 && <div className="tm-empty lbl">NO FLIGHTS LOADED</div>}
        {total > 0 && visible.length === 0 && (
          <div className="tm-empty lbl">NO FLIGHTS MATCH THESE FILTERS</div>
        )}
        {groupBySerial(visible).map((group) => (
          <div key={group.sn}>
            <div className="tm-group lbl">
              {group.name} · {group.sn.slice(-6)}
            </div>
            {group.flights.map((f) => (
              <button
                key={f.id}
                className="tm-flight"
                aria-current={f.id === selectedId ? 'true' : undefined}
                onClick={() => onOpen(f)}
              >
                <div className="tm-flight-time">
                  {fmtDate(f.startTime)}
                  {sessionIds.includes(f.id) && <span className="tm-session-tag"> · DROPPED</span>}
                </div>
                <div className="tm-flight-stats lbl">
                  {fmtDuration(f.durationS)} · {fmtKm(f.distanceKm)} · {fmtMeters(f.maxHeightM)}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
