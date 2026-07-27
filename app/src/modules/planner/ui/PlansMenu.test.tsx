// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PlansMenu from './PlansMenu'
import { createPlan } from '../domain/plan'
import type { PlanLibrary } from './usePlanLibrary'

afterEach(cleanup)

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

function renderOpen(
  library: PlanLibrary,
  onClose = vi.fn(),
  onImportPlanFile = vi.fn(),
  onExportPlan = vi.fn(),
) {
  return render(
    <PlansMenu
      open
      onToggle={vi.fn()}
      onClose={onClose}
      library={library}
      onImportPlanFile={onImportPlanFile}
      onExportPlan={onExportPlan}
    />,
  )
}

describe('PlansMenu', () => {
  it('lists saved plans with their derived metadata', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI', customer: 'ADNOC' }), id: 'plan-1' }
    renderOpen(stubLibrary({ entries: [plan] }))
    expect(screen.getByText('ABU DHABI')).toBeInTheDocument()
    expect(screen.getByText(/ADNOC/)).toBeInTheDocument()
    expect(screen.getByText(/0 AOI/)).toBeInTheDocument()
  })

  it('reads SAVED and disables the save item when the plan is clean', () => {
    renderOpen(stubLibrary({ dirty: false }))
    expect(screen.getByRole('menuitem', { name: /SAVED/ })).toBeDisabled()
  })

  it('saves directly when the plan is not already in the library', () => {
    const savePlan = vi.fn()
    renderOpen(stubLibrary({ dirty: true, isSaved: () => false, savePlan }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'SAVE PLAN' }))
    expect(savePlan).toHaveBeenCalled()
  })

  it('asks before overwriting an entry that already exists', () => {
    const savePlan = vi.fn()
    renderOpen(stubLibrary({ dirty: true, isSaved: () => true, savePlan }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'SAVE PLAN' }))
    expect(savePlan).not.toHaveBeenCalled()
    // Scoped to the confirm label: both the label and the OVERWRITE button
    // itself say "OVERWRITE", and an unscoped query is ambiguous between them.
    expect(screen.getByText(/OVERWRITE/, { selector: '.lbl' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'OVERWRITE' }))
    expect(savePlan).toHaveBeenCalled()
  })

  it('opens a plan immediately when there are no unsaved changes', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const openPlan = vi.fn()
    const onClose = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], dirty: false, openPlan }), onClose)
    // Anchored: the row's own name starts with the plan name, but so does
    // every per-row action button's aria-label ("Rename ABU DHABI", etc.),
    // so an unanchored /ABU DHABI/ matches all four and getByRole throws on
    // ambiguity. Anchoring to the start disambiguates without touching what
    // the test actually verifies.
    fireEvent.click(screen.getByRole('button', { name: /^ABU DHABI/ }))
    expect(openPlan).toHaveBeenCalledWith('plan-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before discarding unsaved changes to open another plan', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const openPlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], dirty: true, openPlan }))
    fireEvent.click(screen.getByRole('button', { name: /^ABU DHABI/ }))
    expect(openPlan).not.toHaveBeenCalled()
    expect(screen.getByText(/UNSAVED CHANGES/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }))
    expect(openPlan).toHaveBeenCalledWith('plan-1')
  })

  it('asks before deleting, and cancelling leaves the plan alone', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const deletePlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], deletePlan }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete ABU DHABI' }))
    expect(screen.getByText(/DELETE\?/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(deletePlan).not.toHaveBeenCalled()
    expect(screen.getByText('ABU DHABI')).toBeInTheDocument()
  })

  it('commits a rename on Enter and abandons it on Escape', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const renamePlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], renamePlan }))

    fireEvent.click(screen.getByRole('button', { name: 'Rename ABU DHABI' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'DUBAI' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renamePlan).toHaveBeenCalledWith('plan-1', 'DUBAI')

    renamePlan.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Rename ABU DHABI' }))
    const again = screen.getByRole('textbox')
    fireEvent.change(again, { target: { value: 'IGNORED' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(renamePlan).not.toHaveBeenCalled()
  })

  it('says so when browser storage is unavailable', () => {
    renderOpen(stubLibrary({ available: false }))
    expect(screen.getByText(/LIBRARY UNAVAILABLE/)).toBeInTheDocument()
  })

  it('reports unreadable entries rather than hiding them', () => {
    renderOpen(stubLibrary({ entries: [], skipped: 2 }))
    expect(screen.getByText(/2 UNREADABLE/)).toBeInTheDocument()
  })

  it('clears a pending confirm/rename when the menu is closed externally, not just via its own close()', () => {
    // PlannerTopbar owns "only one dropdown open at a time" and closes this
    // menu by flipping `open` to false directly (Task 8's job) -- never by
    // calling anything inside this component. A DELETE? banner left standing
    // through that path would resurface, stale, the next time PLANS reopens.
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const library = stubLibrary({ entries: [plan] })
    const onClose = vi.fn()
    const { rerender } = render(
      <PlansMenu
        open
        onToggle={vi.fn()}
        onClose={onClose}
        library={library}
        onImportPlanFile={vi.fn()}
        onExportPlan={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete ABU DHABI' }))
    expect(screen.getByText(/DELETE\?/)).toBeInTheDocument()

    rerender(
      <PlansMenu
        open={false}
        onToggle={vi.fn()}
        onClose={onClose}
        library={library}
        onImportPlanFile={vi.fn()}
        onExportPlan={vi.fn()}
      />,
    )
    rerender(
      <PlansMenu
        open
        onToggle={vi.fn()}
        onClose={onClose}
        library={library}
        onImportPlanFile={vi.fn()}
        onExportPlan={vi.fn()}
      />,
    )

    expect(screen.getByText('ABU DHABI')).toBeInTheDocument()
    expect(screen.queryByText(/DELETE\?/)).not.toBeInTheDocument()
  })

  it('duplicates a plan', () => {
    const plan = { ...createPlan({ name: 'ABU DHABI' }), id: 'plan-1' }
    const duplicatePlan = vi.fn()
    renderOpen(stubLibrary({ entries: [plan], duplicatePlan }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate ABU DHABI' }))
    expect(duplicatePlan).toHaveBeenCalledWith('plan-1')
  })

  it('exports the current plan and closes the menu', () => {
    const onExportPlan = vi.fn()
    const onClose = vi.fn()
    renderOpen(stubLibrary(), onClose, vi.fn(), onExportPlan)
    fireEvent.click(screen.getByRole('menuitem', { name: 'EXPORT PLAN' }))
    expect(onExportPlan).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('exports the library and closes the menu', () => {
    const exportLibraryFile = vi.fn()
    const onClose = vi.fn()
    renderOpen(stubLibrary({ exportLibraryFile }), onClose)
    fireEvent.click(screen.getByRole('menuitem', { name: 'EXPORT LIBRARY' }))
    expect(exportLibraryFile).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('imports a plan file through the hidden plan input', () => {
    const onImportPlanFile = vi.fn()
    const onClose = vi.fn()
    const { container } = renderOpen(stubLibrary(), onClose, onImportPlanFile)
    const [planInput] = container.querySelectorAll('input[type="file"]')
    const file = new File(['{}'], 'plan.json', { type: 'application/json' })
    fireEvent.change(planInput, { target: { files: [file] } })
    expect(onImportPlanFile).toHaveBeenCalledWith(file)
    expect(onClose).toHaveBeenCalled()
  })

  it('imports a library file through the hidden library input', () => {
    const importLibraryFile = vi.fn()
    const onClose = vi.fn()
    const { container } = renderOpen(stubLibrary({ importLibraryFile }), onClose)
    const inputs = container.querySelectorAll('input[type="file"]')
    const libraryInput = inputs[1]
    const file = new File(['{}'], 'library.json', { type: 'application/json' })
    fireEvent.change(libraryInput, { target: { files: [file] } })
    expect(importLibraryFile).toHaveBeenCalledWith(file)
    expect(onClose).toHaveBeenCalled()
  })
})
