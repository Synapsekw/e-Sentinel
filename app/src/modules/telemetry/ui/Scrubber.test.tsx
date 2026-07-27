// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Scrubber from './Scrubber'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30,
  distanceKm: 1,
  maxHeightM: 100,
  maxSpeedMs: 10,
  recordCount: 2,
  home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    {
      t: 0,
      lon: 48,
      lat: 28.78,
      alt: 0,
      height: 0,
      speedH: 0,
      speedV: 0,
      heading: 0,
      gimbalPitch: 0,
      battery: 100,
      voltage: 50,
      sats: 20,
      mode: 'GPSAtti',
    },
    {
      t: 120,
      lon: 48.01,
      lat: 28.79,
      alt: 90,
      height: 50,
      speedH: 5,
      speedV: 0,
      heading: 90,
      gimbalPitch: -30,
      battery: 80,
      voltage: 49,
      sats: 32,
      mode: 'GPSWaypoint',
    },
  ],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('Scrubber', () => {
  it('disables the track with no flight loaded', () => {
    render(<Scrubber />)
    expect(screen.getByRole('slider')).toBeDisabled()
  })

  it('shows the cursor position against the total duration', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(62)
    render(<Scrubber />)
    expect(screen.getByText('T+01:02 / 02:00')).toBeInTheDocument()
  })

  it('moves the cursor when the track is dragged', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '45' } })
    expect(useTelemetryStore.getState().cursorT).toBe(45)
  })

  it('toggles playback from the play button', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('shows a pause affordance while playing', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    render(<Scrubber />)
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
  })

  it('cycles the playback rate', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    expect(useTelemetryStore.getState().rate).toBe(4)
  })

  it('toggles playback on space', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('steps the cursor forward and back with the arrow keys', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(10)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(11)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(10)
  })

  it('takes a larger step with shift held', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(30)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(40)
  })

  // Space is also "activate" for a focused button, and the topbar's search
  // box needs its space bar to type. Shortcuts must stand down for both.
  it('ignores keys while a text field has focus', () => {
    useTelemetryStore.getState().setPath(path)
    render(
      <>
        <input aria-label="search" />
        <Scrubber />
      </>,
    )
    const input = screen.getByLabelText('search')
    input.focus()
    fireEvent.keyDown(input, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  it('does nothing with no flight loaded', () => {
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(false)
  })
})
