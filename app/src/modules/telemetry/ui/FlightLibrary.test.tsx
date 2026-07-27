// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import FlightLibrary from './FlightLibrary'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta } from '../domain/types'

function flight(over: Partial<FlightMeta>): FlightMeta {
  return {
    id: 'f',
    file: 'f.txt',
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
    ...over,
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('FlightLibrary', () => {
  it('shows an empty state with no flights', () => {
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/no flights/i)).toBeInTheDocument()
  })

  it('renders one row per flight with its stats', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText('2026-02-17 06:27')).toBeInTheDocument()
    expect(screen.getByText(/45m 23s/)).toBeInTheDocument()
    expect(screen.getByText(/22\.1 km/)).toBeInTheDocument()
  })

  it('groups rows under an aircraft heading', () => {
    useTelemetryStore
      .getState()
      .setCatalog([flight({ id: 'a', aircraftSn: 'SN1' }), flight({ id: 'b', aircraftSn: 'SN2' })])
    const { container } = render(<FlightLibrary onOpen={vi.fn()} />)
    // Scoped to .tm-list: LibraryFilters' AIRCRAFT <select> renders its own
    // "Matrice 400 · SN1" / "Matrice 400 · SN2" <option> text (identical to
    // the group headings, since both format aircraft as `name · sn`), so an
    // unscoped getAllByText(/Matrice 400/) collects those two <option>
    // elements too and finds 4, not 2.
    const list = container.querySelector('.tm-list') as HTMLElement
    expect(within(list).getAllByText(/Matrice 400/)).toHaveLength(2)
  })

  it('calls onOpen with the flight when a row is clicked', () => {
    const onOpen = vi.fn()
    const a = flight({ id: 'a' })
    useTelemetryStore.getState().setCatalog([a])
    render(<FlightLibrary onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /06:27/ }))
    expect(onOpen).toHaveBeenCalledWith(a)
  })

  it('marks the selected row as current', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    useTelemetryStore.getState().select('a')
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: /06:27/ })).toHaveAttribute('aria-current', 'true')
  })

  it('tags session drop-ins distinctly', () => {
    useTelemetryStore.getState().addSessionFlight(flight({ id: 'dropped' }))
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/· DROPPED/)).toBeInTheDocument()
  })

  it('offers no clear control until something has been dropped', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('clears session drop-ins on demand', () => {
    useTelemetryStore.getState().addSessionFlight(flight({ id: 'dropped' }))
    render(<FlightLibrary onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /clear 1 dropped/i }))
    expect(useTelemetryStore.getState().sessionFlights).toEqual([])
  })

  it('reports when filters exclude everything', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    useTelemetryStore.getState().setFilters({ ...initial.filters, text: 'zzz' })
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/no flights match/i)).toBeInTheDocument()
  })
})
