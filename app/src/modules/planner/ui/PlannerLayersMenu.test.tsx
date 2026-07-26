// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PlannerLayersMenu from './PlannerLayersMenu'
import { useAppStore } from '@/shared/store'

const pristine = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(pristine)
})

describe('PlannerLayersMenu trigger label', () => {
  it('names the active basemap, matching the console topbar', () => {
    useAppStore.setState({ layer: 'dark' })
    render(<PlannerLayersMenu open={false} onToggle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('LAYERS · DARK')
  })

  it('tracks a change of basemap', () => {
    useAppStore.setState({ layer: 'terrain' })
    render(<PlannerLayersMenu open={false} onToggle={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('LAYERS · TERRAIN')
  })

  it('check-marks the active row when open', () => {
    useAppStore.setState({ layer: 'sat' })
    render(<PlannerLayersMenu open onToggle={vi.fn()} onClose={vi.fn()} />)
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows).toHaveLength(4)
    const active = rows.find((r) => r.getAttribute('aria-checked') === 'true')
    expect(active).toHaveTextContent('SATELLITE')
  })
})
