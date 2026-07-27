// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import PlannerTopbar from './PlannerTopbar'
import { useAppStore } from '@/shared/store'
import type { PlanLibrary } from './usePlanLibrary'

const pristine = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(pristine)
})

// Mirrors PlansMenu.test.tsx's stubLibrary -- same 15-member shape, since
// PlansMenu now renders live under PlannerTopbar and needs a complete
// PlanLibrary to do so.
function stubLibrary(over: Partial<PlanLibrary> = {}): PlanLibrary {
  return {
    entries: [],
    skipped: 0,
    available: true,
    dirty: false,
    currentPlanId: 'plan-current',
    isSaved: () => false,
    refresh: vi.fn(),
    savePlan: vi.fn(),
    saveAsNew: vi.fn(),
    openPlan: vi.fn(),
    renamePlan: vi.fn(),
    duplicatePlan: vi.fn(),
    deletePlan: vi.fn(),
    exportLibraryFile: vi.fn(),
    importLibraryFile: vi.fn(),
    ...over,
  }
}

function renderTopbar() {
  return render(
    <MemoryRouter>
      <PlannerTopbar
        drawMode="idle"
        onSetDrawMode={vi.fn()}
        onCancelDraw={vi.fn()}
        placingDock={false}
        onToggleDockPlacement={vi.fn()}
        onImportAoiFile={vi.fn()}
        onImportPlanFile={vi.fn()}
        onExportPlan={vi.fn()}
        onSuggestLayout={vi.fn()}
        suggestBusy={false}
        library={stubLibrary()}
      />
    </MemoryRouter>,
  )
}

describe('PlannerTopbar grouping', () => {
  it('leads the action row with LAYERS, as the console topbar does', () => {
    useAppStore.setState({ layer: 'dark' })
    renderTopbar()
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t.length > 0)
    expect(labels[0]).toContain('LAYERS · DARK')
  })

  it('keeps every tool control reachable', () => {
    renderTopbar()
    for (const label of [
      'LAYERS · DARK',
      'DRAW',
      '+ DOCK',
      'SUGGEST LAYOUT',
      'IMPORT AOI',
      'PLANS ▾',
    ]) {
      expect(screen.getAllByRole('button').some((b) => b.textContent?.includes(label))).toBe(true)
    }
    expect(screen.getByRole('link', { name: /MODULES/ })).toBeInTheDocument()
  })

  it('no longer carries standalone plan import/export buttons', () => {
    // They moved into the PLANS dropdown: the topbar row already starts
    // dropping items at 1120px, so three plan-io buttons became one.
    renderTopbar()
    expect(screen.queryByRole('button', { name: 'IMPORT PLAN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'EXPORT PLAN' })).toBeNull()
    expect(screen.getByRole('button', { name: /PLANS/ })).toBeInTheDocument()
  })

  // Same gesture as the console's `.t-brand`/`.g-brand`: the logo goes home
  // from every surface, so the presenter never has to hunt for the way out.
  it('the brand block is a link to the landing page', () => {
    renderTopbar()
    const brand = screen.getByText('DEPLOYMENT PLANNER').closest('a')
    expect(brand).toHaveAttribute('href', '/')
    expect(brand?.querySelector('img.pl-logo')).toBeTruthy()
  })
})

describe('PlannerTopbar offline chip', () => {
  it('is hidden while online', () => {
    useAppStore.setState({ offline: false })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).not.toBeVisible()
  })

  it('shows when the map has fallen back to the offline vector map', () => {
    useAppStore.setState({ offline: true })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).toBeVisible()
  })

  it('wears the planner chip class, not the console chrome.css one', () => {
    useAppStore.setState({ offline: true })
    renderTopbar()
    expect(screen.getByText(/OFFLINE MODE/)).toHaveClass('pl-chip')
  })
})
