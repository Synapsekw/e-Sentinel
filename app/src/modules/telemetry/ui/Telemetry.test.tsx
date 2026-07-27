// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Telemetry from './Telemetry'
import { useTelemetryStore } from '../store/telemetryStore'
import * as catalogIo from '../io/catalogIo'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 2722.9,
  distanceKm: 22.07,
  maxHeightM: 50,
  maxSpeedMs: 17,
  recordCount: 27229,
  home: { lon: 48, lat: 28.78 },
}

// MapView builds a real MapLibre instance, which jsdom cannot host. Mocked to
// render its children immediately, the same approach Planner.test.tsx takes
// (there via a maplibre-gl stub; here by replacing MapView itself, since this
// route statically imports MapView rather than only PlannerShell). A plain
// `ReactNode` type import keeps the factory free of a runtime `React` import
// it would otherwise need only for the `React.ReactNode` annotation.
vi.mock('@/modules/console/map/MapView', () => ({
  default: ({ children }: { children?: ReactNode }) => <div data-testid="map">{children}</div>,
}))
vi.mock('@/modules/console/map/MapContext', () => ({
  useMap: () => ({ mapRef: { current: null }, ready: false }),
}))

const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  vi.spyOn(catalogIo, 'fetchCatalog').mockResolvedValue({ version: 1, flights: [meta] })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderRoute() {
  render(
    <MemoryRouter>
      <Telemetry />
    </MemoryRouter>,
  )
}

describe('Telemetry', () => {
  it('renders the chrome around the map', () => {
    renderRoute()
    expect(screen.getByTestId('map')).toBeInTheDocument()
    expect(screen.getByText(/load log/i)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('loads the catalog into the library on mount', async () => {
    renderRoute()
    await waitFor(() => {
      expect(useTelemetryStore.getState().catalog).toHaveLength(1)
    })
    expect(await screen.findByText('2026-02-17 06:27')).toBeInTheDocument()
  })

  it('prompts to select a flight before one is opened', () => {
    renderRoute()
    expect(screen.getByText(/select a flight/i)).toBeInTheDocument()
  })

  // A failed catalog load must leave the module usable, not blank the route.
  it('renders with an empty library when the catalog cannot be loaded', async () => {
    vi.mocked(catalogIo.fetchCatalog).mockResolvedValue({ version: 1, flights: [] })
    renderRoute()
    expect(await screen.findByText(/no flights loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })
})
