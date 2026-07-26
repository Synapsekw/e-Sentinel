// Ported (Phase 1D / Task 4) test for Topbar.tsx. See Topbar.tsx's header
// comment for the legacy source refs this component transcribes.

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Topbar from './Topbar'
import type { TopbarProps } from './Topbar'
import { useAppStore } from '@/shared/store'

// The brand block is a react-router <Link> home (Topbar.tsx), so every render
// needs a router in context or useHref() throws. MemoryRouter rather than
// BrowserRouter for the same reason PlannerTopbar.test.tsx uses it: no jsdom
// history/URL side effects between tests.
function renderTopbar(props: Partial<TopbarProps> = {}) {
  return render(
    <MemoryRouter>
      <Topbar onExitToOrbit={() => {}} {...props} />
    </MemoryRouter>,
  )
}

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
    renderTopbar()
    expect(screen.getByText('SENTINEL')).toBeTruthy()
    expect(screen.getByText('GRID ONLINE')).toBeTruthy()
    expect(screen.getByRole('button', { name: /LAYERS/ }).textContent).toContain('DARK')
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).not.toContain('·')
  })

  it('shows the active filter on the FILTER trigger', () => {
    useAppStore.setState({ dockFilter: 'DXB' })
    renderTopbar()
    expect(screen.getByRole('button', { name: /FILTER/ }).textContent).toContain('DXB')
  })

  it('hides the ALERTS chip at zero and shows it above zero', () => {
    const { rerender } = renderTopbar()
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(true)
    act(() => {
      useAppStore.setState({ stats: { ready: 90, flying: 7, charge: 5, alert: 3 } })
    })
    rerender(
      <MemoryRouter>
        <Topbar onExitToOrbit={() => {}} />
      </MemoryRouter>,
    )
    expect(document.getElementById('c-alerts')?.hasAttribute('hidden')).toBe(false)
  })

  it('OPS clears selection, follow and the right panel (panels.js:2504-2512)', () => {
    renderTopbar()
    act(() => {
      screen.getByRole('button', { name: 'OPS' }).click()
    })
    expect(useAppStore.getState().selection).toBe(null)
    expect(useAppStore.getState().followDroneId).toBe(null)
    expect(useAppStore.getState().rightPanel).toEqual({ mode: 'empty' })
  })

  it('GLOBE calls the exit handler', () => {
    const exit = vi.fn()
    renderTopbar({ onExitToOrbit: exit })
    act(() => {
      screen.getByRole('button', { name: 'GLOBE' }).click()
    })
    expect(exit).toHaveBeenCalledTimes(1)
  })

  // Inside the theater the topbar is the only chrome on screen and GLOBE only
  // flips the scene, so the brand block is the sole route out of /console.
  it('the brand block is a link to the landing page', () => {
    renderTopbar()
    const brand = screen.getByText('SENTINEL').closest('a')
    expect(brand).toBeTruthy()
    expect(brand?.getAttribute('href')).toBe('/')
    // The logo has to be INSIDE the link, not merely adjacent to it -- clicking
    // the e& mark is the gesture this exists for.
    expect(brand?.querySelector('img.t-logo')).toBeTruthy()
  })

  // The href assertion above proves the markup; this proves the gesture. A real
  // <Routes> tree is the only way to catch the case where the link is correct
  // but navigation never lands (e.g. something upstream swallowing the click),
  // which is the entire behavior being added here.
  it('clicking the logo navigates to the landing route', () => {
    render(
      <MemoryRouter initialEntries={['/console']}>
        <Routes>
          <Route path="/" element={<div>MODULE LANDING</div>} />
          <Route path="/console" element={<Topbar onExitToOrbit={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('MODULE LANDING')).toBe(null)

    act(() => {
      fireEvent.click(screen.getByAltText('e&'))
    })
    expect(screen.getByText('MODULE LANDING')).toBeTruthy()
  })
})
