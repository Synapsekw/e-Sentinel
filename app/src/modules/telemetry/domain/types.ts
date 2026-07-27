// The telemetry module's vocabulary. `flight` is one log, `flight path` is
// its geometry, `frame`/`sample` is one point in time. Deliberately NOT
// `track`: modules/console already owns that word for detected ground
// targets (see console/panels/TrackPanel.tsx).

// Bump when the shape of FlightSample or the normalization in
// io/djiLog.worker.ts changes. io/flightCache.ts keys cached paths on it, so
// a bump invalidates stale entries instead of silently serving them.
export const NORMALIZER_VERSION = 1

// One catalog row. Every field here comes from a DJI log's UNENCRYPTED
// details block, which is why the library renders in full without a keychain.
export interface FlightMeta {
  id: string
  file: string
  version: number
  encrypted: boolean
  hasKeychain: boolean
  aircraftName: string
  aircraftSn: string
  startTime: string
  durationS: number
  distanceKm: number
  maxHeightM: number
  maxSpeedMs: number
  recordCount: number
  home: { lon: number; lat: number }
}

export interface FlightCatalog {
  version: 1
  flights: FlightMeta[]
}

// The normalization seam. DJI's Frame carries ~100 fields and serializes to
// 65MB for a 27k-record log; this is the 13-field subset the UI actually
// reads. Nothing above io/ ever sees a DJI type.
export interface FlightSample {
  t: number
  lon: number
  lat: number
  alt: number
  height: number
  speedH: number
  speedV: number
  heading: number
  gimbalPitch: number
  battery: number
  voltage: number
  sats: number
  mode: string
}

export interface FlightPath {
  meta: FlightMeta
  samples: FlightSample[]
}

export interface CatalogFilters {
  aircraftSn: string | null
  from: string | null
  to: string | null
  minDurationS: number
  text: string
}

export type CatalogSort = 'newest' | 'oldest' | 'duration' | 'distance'

export const NO_FILTERS: CatalogFilters = {
  aircraftSn: null,
  from: null,
  to: null,
  minDurationS: 0,
  text: '',
}
