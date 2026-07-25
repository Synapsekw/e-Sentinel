// Ported (Phase 1D / Task 4) test for Topbar.tsx. See Topbar.tsx's header
// comment for the legacy source refs this component transcribes.

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import Topbar from './Topbar'
import { useAppStore } from '@/shared/store'

describe('Topbar', () => {
  // Vitest's config doesn't set `test.globals: true`, so @testing-library/
  // react's implicit `afterEach(cleanup)` registration (which checks for a
  // global `afterEach` at import time) never fires; every other multi-render
  // suite in this repo (Console.test.tsx, Ticker.test.tsx) explicitly wires
  // it instead. Without this, DOM from an earlier render in this file (e.g.
  // an earlier `GLOBE` button) would still be attached when a later test
  // queries `getByRole`, producing a "multiple elements found" failure.
  afterEach(cleanup)

  beforeEach(() => {
    useAppStore.setState({
      stats: { ready: 90, flying: 7, charge: 5, alert: 0 },
      offline: false,
      dockFilter: 'ALL',
      layer: 'dark',
      selection: { type: 'dock', id: 'X' },
      rightPanel: { mode: 'dock', id: 'X' },
      followDroneId: 'D-X',
    })
  })

  it('renders the brand, the grid-online chip and the layer/filter labels', () => {
    render(<Topbar onExitToOrbit={() => {}} />)
    expect(screen.getByText('SENTINEL')).toBeTruthy()
    expect(screen.getByText('GRID ONLINE')).toBeTruthy()
    expect(screen.getByRole('button', { name: /LAYERS/ }).textContent).toContain('DARK')
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).not.toContain('·')
  })

  it('shows the active filter on the FILTER trigger', () => {
    useAppStore.setState({ dockFilter: 'DXB' })
    render(<Topbar onExitToOrbit={() => {}} />)
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).toContain('DXB')
  })

  it('hides the ALERTS chip at zero and shows it above zero', () => {
    const { rerender } = render(<Topbar onExitToOrbit={() => {}} />)
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(true)
    act(() => {
      useAppStore.setState({ stats: { ready: 90, flying: 7, charge: 5, alert: 3 } })
    })
    rerender(<Topbar onExitToOrbit={() => {}} />)
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(false)
  })

  it('OPS clears selection, follow and the right panel (panels.js:2504-2512)', () => {
    render(<Topbar onExitToOrbit={() => {}} />)
    act(() => {
      screen.getByRole('button', { name: 'OPS' }).click()
    })
    expect(useAppStore.getState().selection).toBe(null)
    expect(useAppStore.getState().followDroneId).toBe(null)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'empty' })
  })

  it('GLOBE calls the exit handler', () => {
    const exit = vi.fn()
    render(<Topbar onExitToOrbit={exit} />)
    act(() => {
      screen.getByRole('button', { name: 'GLOBE' }).click()
    })
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
