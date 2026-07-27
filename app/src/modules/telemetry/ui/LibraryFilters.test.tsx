// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import LibraryFilters from './LibraryFilters'
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
    durationS: 100,
    distanceKm: 5,
    maxHeightM: 50,
    maxSpeedMs: 10,
    recordCount: 10,
    home: { lon: 48, lat: 28.78 },
    ...over,
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  useTelemetryStore
    .getState()
    .setCatalog([flight({ id: 'a', aircraftSn: 'SN1' }), flight({ id: 'b', aircraftSn: 'SN2' })])
})
afterEach(() => cleanup())

describe('LibraryFilters', () => {
  it('lists every distinct aircraft plus an all option', () => {
    render(<LibraryFilters />)
    // Scoped to the aircraft select: an unscoped getAllByRole('option') also
    // picks up the sort select's options, which share the same role.
    const aircraftSelect = screen.getByLabelText(/aircraft/i)
    const options = within(aircraftSelect)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options[0]).toMatch(/all aircraft/i)
    expect(options).toHaveLength(3)
  })

  it('sets the aircraft filter', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/aircraft/i), { target: { value: 'SN2' } })
    expect(useTelemetryStore.getState().filters.aircraftSn).toBe('SN2')
  })

  it('clears the aircraft filter when all is chosen', () => {
    useTelemetryStore.getState().setFilters({ ...initial.filters, aircraftSn: 'SN2' })
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/aircraft/i), { target: { value: '' } })
    expect(useTelemetryStore.getState().filters.aircraftSn).toBeNull()
  })

  it('sets the text filter', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'm400' } })
    expect(useTelemetryStore.getState().filters.text).toBe('m400')
  })

  it('sets the date bounds', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText(/to/i), { target: { value: '2026-02-28' } })
    const f = useTelemetryStore.getState().filters
    expect(f.from).toBe('2026-02-01')
    expect(f.to).toBe('2026-02-28')
  })

  it('sets minimum duration in whole minutes', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/min duration/i), { target: { value: '5' } })
    expect(useTelemetryStore.getState().filters.minDurationS).toBe(300)
  })

  it('changes the sort order', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'distance' } })
    expect(useTelemetryStore.getState().sort).toBe('distance')
  })
})
