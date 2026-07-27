// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import FramePanel from './FramePanel'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: '1581F8DBW258U00A',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 2722.9,
  distanceKm: 22.07,
  maxHeightM: 104,
  maxSpeedMs: 17.04,
  recordCount: 27229,
  home: { lon: 48.004, lat: 28.782 },
}

const path: FlightPath = {
  meta,
  samples: [
    {
      t: 0,
      lon: 48.004,
      lat: 28.782,
      alt: 91.9,
      height: 49.9,
      speedH: 12.4,
      speedV: -1.2,
      heading: 116.9,
      gimbalPitch: -30,
      battery: 67,
      voltage: 50.067,
      sats: 32,
      mode: 'GPSWaypoint',
    },
  ],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('FramePanel', () => {
  it('prompts to pick a flight when nothing is selected', () => {
    render(<FramePanel />)
    expect(screen.getByText(/select a flight/i)).toBeInTheDocument()
  })

  it('shows the flight summary once a path is loaded', () => {
    useTelemetryStore.getState().setPath(path)
    render(<FramePanel />)
    expect(screen.getByText('Matrice 400')).toBeInTheDocument()
    expect(screen.getByText('1581F8DBW258U00A')).toBeInTheDocument()
    expect(screen.getByText('45m 23s')).toBeInTheDocument()
    expect(screen.getByText('22.1 km')).toBeInTheDocument()
  })

  it('shows readouts at the cursor', () => {
    useTelemetryStore.getState().setPath(path)
    render(<FramePanel />)
    expect(screen.getByText('50 m')).toBeInTheDocument()
    expect(screen.getByText('12.4 m/s')).toBeInTheDocument()
    expect(screen.getByText('117°')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('32')).toBeInTheDocument()
    expect(screen.getByText('GPSWaypoint')).toBeInTheDocument()
  })

  it('shows a loading state while decoding', () => {
    useTelemetryStore.setState({ selectedId: 'a', loading: true })
    render(<FramePanel />)
    expect(screen.getByText(/decoding/i)).toBeInTheDocument()
  })

  it('shows a decode error without losing the panel', () => {
    useTelemetryStore.getState().setError('Not a DJI flight record')
    render(<FramePanel />)
    expect(screen.getByText('Not a DJI flight record')).toBeInTheDocument()
  })

  // A v13+ flight with no baked keychain is a normal state, not an error:
  // the metadata is fully readable and only the frames are locked.
  it('shows FRAMES LOCKED with the summary for an unkeyed flight', () => {
    const locked = { ...meta, id: 'locked', hasKeychain: false }
    useTelemetryStore.setState({ catalog: [locked], selectedId: 'locked', path: null })
    render(<FramePanel />)
    expect(screen.getByText(/frames locked/i)).toBeInTheDocument()
    expect(screen.getByText('Matrice 400')).toBeInTheDocument()
  })
})
