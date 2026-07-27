// Pure catalog filtering and sorting. Every filter reads a field that comes
// from a log's unencrypted details block, so the library filters correctly
// whether or not any keychain was baked.

import type { CatalogFilters, CatalogSort, FlightMeta } from './types'

function matchesText(f: FlightMeta, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (q === '') return true
  return (
    f.aircraftName.toLowerCase().includes(q) ||
    f.aircraftSn.toLowerCase().includes(q) ||
    f.file.toLowerCase().includes(q)
  )
}

export function filterFlights(flights: FlightMeta[], filters: CatalogFilters): FlightMeta[] {
  return flights.filter((f) => {
    if (filters.aircraftSn && f.aircraftSn !== filters.aircraftSn) return false

    const start = Date.parse(f.startTime)
    if (filters.from && start < Date.parse(`${filters.from}T00:00:00Z`)) return false
    // Inclusive of the whole `to` day: a user picking a date means that date,
    // not the instant it begins.
    if (filters.to && start > Date.parse(`${filters.to}T23:59:59.999Z`)) return false

    if (f.durationS < filters.minDurationS) return false
    return matchesText(f, filters.text)
  })
}

const COMPARATORS: Record<CatalogSort, (a: FlightMeta, b: FlightMeta) => number> = {
  newest: (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
  oldest: (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  duration: (a, b) => b.durationS - a.durationS,
  distance: (a, b) => b.distanceKm - a.distanceKm,
}

// Copies before sorting: the store holds the catalog array, and an in-place
// sort would mutate state a component is already rendering from.
export function sortFlights(flights: FlightMeta[], sort: CatalogSort): FlightMeta[] {
  return [...flights].sort(COMPARATORS[sort])
}

export interface AircraftOption {
  sn: string
  name: string
}

export function aircraftOptions(flights: FlightMeta[]): AircraftOption[] {
  const bySn = new Map<string, AircraftOption>()
  for (const f of flights) {
    if (!bySn.has(f.aircraftSn)) bySn.set(f.aircraftSn, { sn: f.aircraftSn, name: f.aircraftName })
  }
  return [...bySn.values()].sort((a, b) => a.name.localeCompare(b.name) || a.sn.localeCompare(b.sn))
}
