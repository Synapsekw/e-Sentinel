// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'
import TelemetryTopbar from './TelemetryTopbar'

afterEach(() => cleanup())

function renderBar(onLoad = vi.fn()) {
  render(
    <MemoryRouter>
      <TelemetryTopbar onLoadFile={onLoad} />
    </MemoryRouter>,
  )
  return onLoad
}

describe('TelemetryTopbar', () => {
  it('links the brand home to the module landing page', () => {
    renderBar()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/')
  })

  it('offers a load control', () => {
    renderBar()
    expect(screen.getByText(/load log/i)).toBeInTheDocument()
  })

  it('passes a chosen file up', () => {
    const onLoad = renderBar()
    const file = new File(['x'], 'flight.txt', { type: 'text/plain' })
    const input = screen.getByLabelText(/load log/i)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onLoad).toHaveBeenCalledWith(file)
  })

  it('ignores a change event with no file', () => {
    const onLoad = renderBar()
    fireEvent.change(screen.getByLabelText(/load log/i), { target: { files: [] } })
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('offers the basemap layers control', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /layers/i })).toBeInTheDocument()
  })

  it('opens the layers menu on click', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    expect(screen.getByRole('button', { name: /satellite/i })).toBeInTheDocument()
  })
})
