// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import TelemetryLayersMenu from './TelemetryLayersMenu'
import { useAppStore } from '@/shared/store'

const pristine = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(pristine)
})

describe('TelemetryLayersMenu', () => {
  it('names the active basemap, matching the console and planner topbars', () => {
    useAppStore.setState({ layer: 'dark' })
    render(<TelemetryLayersMenu />)
    expect(screen.getByRole('button', { name: /layers/i })).toHaveTextContent('LAYERS · DARK')
  })

  it('tracks a change of basemap', () => {
    useAppStore.setState({ layer: 'terrain' })
    render(<TelemetryLayersMenu />)
    expect(screen.getByRole('button', { name: /layers/i })).toHaveTextContent('LAYERS · TERRAIN')
  })

  it('stays closed until the trigger is clicked', () => {
    render(<TelemetryLayersMenu />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens on click and lists all four basemaps', () => {
    render(<TelemetryLayersMenu />)
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    const menu = screen.getByRole('menu')
    expect(menu.querySelectorAll('.tm-menu-item')).toHaveLength(4)
  })

  it('marks the active row with aria-pressed and a check', () => {
    // Scoped with within(menu): with layer 'sat' the trigger's own label
    // ("LAYERS · SATELLITE") also matches /satellite/i, so an unscoped query
    // here collides between the trigger button and the row button.
    useAppStore.setState({ layer: 'sat' })
    render(<TelemetryLayersMenu />)
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    const menu = within(screen.getByRole('menu'))
    const active = menu.getByRole('button', { name: /satellite/i })
    expect(active).toHaveAttribute('aria-pressed', 'true')
    expect(active).toHaveTextContent('✓')
  })

  it('selects a layer, updates the store and closes the menu', () => {
    useAppStore.setState({ layer: 'dark' })
    render(<TelemetryLayersMenu />)
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    fireEvent.click(screen.getByRole('button', { name: /terrain/i }))
    expect(useAppStore.getState().layer).toBe('terrain')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on an outside click without changing the layer', () => {
    useAppStore.setState({ layer: 'dark' })
    render(
      <div>
        <TelemetryLayersMenu />
        <button type="button">outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(useAppStore.getState().layer).toBe('dark')
  })
})
