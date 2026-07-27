// Telemetry-local state. Deliberately NOT a slice of shared/store.ts, the
// same call planner/store/planStore.ts records: nothing outside /telemetry
// reads a flight, and cursorT changes on every animation frame during
// playback, which would churn a global store the console also subscribes to.

import { create } from 'zustand'
import { filterFlights, sortFlights } from '../domain/filters'
import { NO_FILTERS } from '../domain/types'
import type { CatalogFilters, CatalogSort, FlightMeta, FlightPath } from '../domain/types'

export type PlaybackRate = 1 | 4 | 16
const RATES: PlaybackRate[] = [1, 4, 16]

function duration(path: FlightPath | null): number {
  if (!path || path.samples.length === 0) return 0
  return path.samples[path.samples.length - 1].t
}

interface TelemetryState {
  catalog: FlightMeta[]
  sessionFlights: FlightMeta[]
  filters: CatalogFilters
  sort: CatalogSort
  selectedId: string | null
  path: FlightPath | null
  loading: boolean
  error: string | null
  cursorT: number
  playing: boolean
  rate: PlaybackRate

  setCatalog(flights: FlightMeta[]): void
  addSessionFlight(meta: FlightMeta): void
  clearSessionFlights(): void
  setFilters(filters: CatalogFilters): void
  setSort(sort: CatalogSort): void
  select(id: string | null): void
  setLoading(loading: boolean): void
  setPath(path: FlightPath): void
  setError(error: string): void
  setCursor(t: number): void
  togglePlay(): void
  cycleRate(): void
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  catalog: [],
  sessionFlights: [],
  filters: NO_FILTERS,
  sort: 'newest',
  selectedId: null,
  path: null,
  loading: false,
  error: null,
  cursorT: 0,
  playing: false,
  rate: 1,

  setCatalog: (catalog) => set({ catalog }),
  addSessionFlight: (meta) =>
    set((s) => ({
      sessionFlights: [meta, ...s.sessionFlights.filter((f) => f.id !== meta.id)],
    })),
  clearSessionFlights: () => set({ sessionFlights: [] }),
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),

  select: (selectedId) => set({ selectedId, error: null }),
  setLoading: (loading) => set({ loading }),

  setPath: (path) => set({ path, loading: false, error: null, cursorT: 0, playing: false }),
  setError: (error) => set({ error, loading: false, path: null }),

  setCursor: (t) => {
    const total = duration(get().path)
    const cursorT = Math.min(total, Math.max(0, t))
    set(cursorT >= total ? { cursorT, playing: false } : { cursorT })
  },

  togglePlay: () => {
    const { path, playing, cursorT } = get()
    if (!path || path.samples.length === 0) return
    if (playing) return set({ playing: false })
    // Pressing play at the end replays from the start rather than doing
    // nothing, which is what a second press after a finished run means.
    set({ playing: true, cursorT: cursorT >= duration(path) ? 0 : cursorT })
  },

  cycleRate: () => set((s) => ({ rate: RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] })),
}))

// A STANDALONE selector, deliberately not a method on the store.
//
// As a store method returning a fresh array, `useTelemetryStore((s) =>
// s.visibleFlights())` would hand React's useSyncExternalStore a new
// reference on every call and trip its "The result of getSnapshot should be
// cached to avoid an infinite loop" guard. Components subscribe to the four
// raw slices and memoize this call instead.
export function selectVisibleFlights(state: {
  catalog: FlightMeta[]
  sessionFlights: FlightMeta[]
  filters: CatalogFilters
  sort: CatalogSort
}): FlightMeta[] {
  const { catalog, sessionFlights, filters, sort } = state
  // Session drop-ins lead: a file the user just handed over is what they are
  // looking for, and burying it under the baked catalog's sort order is the
  // wrong answer even when the sort says otherwise.
  return [
    ...sortFlights(filterFlights(sessionFlights, filters), sort),
    ...sortFlights(filterFlights(catalog, filters), sort),
  ]
}

export { duration as pathDuration }
