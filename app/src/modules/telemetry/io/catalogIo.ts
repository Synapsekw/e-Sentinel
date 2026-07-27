// Loads and validates the baked catalog. The bake tool is a separate Node
// program outside app/'s typecheck and lint, so its output is treated as
// untrusted input here -- the same stance planner/domain/planIo.ts takes
// toward an imported plan file.

import type { FlightCatalog, FlightMeta } from '../domain/types'

const EMPTY: FlightCatalog = { version: 1, flights: [] }

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseFlight(raw: unknown): FlightMeta | null {
  if (typeof raw !== 'object' || raw === null) return null
  const f = raw as Record<string, unknown>
  const home = f.home as Record<string, unknown> | undefined

  if (typeof f.id !== 'string' || f.id === '') return null
  if (typeof f.file !== 'string' || f.file === '') return null
  if (!isNum(f.version)) return null
  if (typeof f.aircraftName !== 'string') return null
  if (typeof f.aircraftSn !== 'string') return null
  if (typeof f.startTime !== 'string' || !Number.isFinite(Date.parse(f.startTime))) return null
  if (!isNum(f.durationS) || !isNum(f.distanceKm)) return null
  if (!isNum(f.maxHeightM) || !isNum(f.maxSpeedMs) || !isNum(f.recordCount)) return null
  if (!home || !isNum(home.lon) || !isNum(home.lat)) return null

  return {
    id: f.id,
    file: f.file,
    version: f.version,
    encrypted: f.encrypted === true,
    hasKeychain: f.hasKeychain === true,
    aircraftName: f.aircraftName,
    aircraftSn: f.aircraftSn,
    startTime: f.startTime,
    durationS: f.durationS,
    distanceKm: f.distanceKm,
    maxHeightM: f.maxHeightM,
    maxSpeedMs: f.maxSpeedMs,
    recordCount: f.recordCount,
    home: { lon: home.lon, lat: home.lat },
  }
}

export function parseCatalog(raw: unknown): FlightCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (c.version !== 1) return null
  if (!Array.isArray(c.flights)) return null
  const flights = c.flights.map(parseFlight).filter((f): f is FlightMeta => f !== null)
  return { version: 1, flights }
}

// Never throws. A missing or corrupt catalog leaves an empty library with the
// drop zone still working, which is strictly better in front of a client than
// a blank route.
export async function fetchCatalog(base: string): Promise<FlightCatalog> {
  try {
    const res = await fetch(`${base}flights/index.json`)
    if (!res.ok) {
      console.error(`[telemetry] catalog fetch failed: HTTP ${res.status}`)
      return EMPTY
    }
    const parsed = parseCatalog(await res.json())
    if (!parsed) {
      console.error('[telemetry] catalog payload malformed')
      return EMPTY
    }
    return parsed
  } catch (err) {
    console.error('[telemetry] could not load catalog', err)
    return EMPTY
  }
}
