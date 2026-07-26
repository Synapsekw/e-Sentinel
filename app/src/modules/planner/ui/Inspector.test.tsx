// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
// This repo's vite.config.ts sets no `test.setupFiles`, so jest-dom's
// matchers (toBeInTheDocument) are never registered globally -- unlike a
// typical CRA/jest setup, they have to be pulled in per file that uses them.
import '@testing-library/jest-dom/vitest'
import Inspector from './Inspector'
import { usePlanStore } from '../store/planStore'
import { createPlan, addDock, resetIdsForTest } from '../domain/plan'
import { DOCK_MODELS, DRONES, effectiveRadius } from '../domain/catalog'
import type { PlannedDock } from '../domain/types'

// vite.config.ts now sets test.globals: true, so @testing-library/react's
// auto-cleanup DOES register. This explicit cleanup() is kept anyway: it is
// idempotent, and it keeps this file correct on its own terms rather than
// depending on a config flag holding still (see the same note in
// useCoverageDriver.test.ts / SummaryStrip.test.tsx).
// Without an explicit cleanup(), a render from one test stays mounted and
// subscribed to usePlanStore, so it keeps reacting to store updates made by
// later tests.
afterEach(() => cleanup())

const pristineStoreState = usePlanStore.getState()

const baseDock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'rural',
  source: 'manual',
}

function selectDock(dock: PlannedDock): void {
  const plan = addDock(createPlan(), dock)
  usePlanStore.setState({
    ...pristineStoreState,
    plan,
    coverage: { ok: false, reason: 'no-aoi' },
    selection: { type: 'dock', id: dock.id },
  })
}

describe('Inspector / DockInspector drone compatibility', () => {
  beforeEach(() => resetIdsForTest())

  it('filters the drone option list to the selected dock model compatible drones', () => {
    // DOCK3 hosts M4TD and M4D, not M350 (see catalog.ts's DOCK_MODELS).
    selectDock(baseDock)
    render(<Inspector />)

    const droneSelect = screen.getByLabelText('Drone')
    const optionLabels = within(droneSelect)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(optionLabels).toEqual([DRONES.M4TD.label, DRONES.M4D.label])
    expect(optionLabels).not.toContain(DRONES.M350.label)
  })

  it('substitutes a compatible drone in the same update when the new dock model cannot host the current drone', () => {
    // This is the exact bug shape a prior review found: DOCK2 only hosts
    // M350, so switching a DOCK3/M4TD dock to DOCK2 must not leave M4TD
    // selected against a dock model that can't fly it.
    selectDock(baseDock)
    render(<Inspector />)

    const dockModelSelect = screen.getByLabelText('Dock model')
    fireEvent.change(dockModelSelect, { target: { value: 'DOCK2' } })

    const updated = usePlanStore.getState().plan.docks.find((d) => d.id === 'd1')
    expect(updated?.dockModel).toBe('DOCK2')
    expect(updated?.droneModel).toBe('M350')
    expect(DOCK_MODELS.DOCK2.drones).toContain(updated?.droneModel)
  })

  it('leaves the current drone alone when the new dock model can still host it', () => {
    // The catalog's two dock models (DOCK3, DOCK2) have disjoint drone
    // lists, so there is no *cross*-model reselection under the current
    // catalog where the drone survives -- any real model switch forces a
    // substitution (see the test above). This exercises the ternary's other
    // branch directly: reselecting the dock's own current model must not
    // touch its drone, because the drone is (trivially, but genuinely)
    // still in that model's allowed list.
    selectDock(baseDock)
    render(<Inspector />)

    const dockModelSelect = screen.getByLabelText('Dock model')
    fireEvent.change(dockModelSelect, { target: { value: 'DOCK3' } })

    const updated = usePlanStore.getState().plan.docks.find((d) => d.id === 'd1')
    expect(updated?.dockModel).toBe('DOCK3')
    expect(updated?.droneModel).toBe('M4TD')
  })

  it('renders a stored incompatible drone as a visibly marked option instead of silently showing a different one (Finding 4)', () => {
    // parsePlan deliberately does not validate dock/drone compatibility, so
    // an imported or hand-edited plan can carry exactly this: a droneModel
    // that isn't in DOCK_MODELS[dockModel].drones. Before the fix, the
    // select's option list didn't include this value at all, so the browser
    // silently fell back to displaying its first option (M4TD/M4D) -- a
    // different drone than the one actually stored, with no visible sign
    // anything was wrong.
    const incompatible: PlannedDock = { ...baseDock, dockModel: 'DOCK2', droneModel: 'M4TD' }
    selectDock(incompatible)
    render(<Inspector />)

    const droneSelect = screen.getByLabelText('Drone')
    // Type-only: getByLabelText's return type is the generic HTMLElement;
    // the label is known (by this file's own markup) to wrap a <select>.
    const droneSelectEl = droneSelect as HTMLSelectElement
    // The select's displayed value must be the truth: what's actually
    // stored, not DOCK2's only real option (M350).
    expect(droneSelectEl.value).toBe('M4TD')
    expect(screen.getByText(/INCOMPATIBLE/i)).toBeInTheDocument()
    expect(screen.getByText(/MATRICE 4TD.*NOT COMPATIBLE.*DOCK 2/i)).toBeInTheDocument()
  })
})

describe('Inspector / DockInspector radius slider', () => {
  beforeEach(() => resetIdsForTest())

  it('renders a slider rather than a number box', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const slider = screen.getByLabelText(/Coverage radius/)
    expect(slider).toHaveAttribute('type', 'range')
  })

  it('shows the derived radius when no override is set', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const derived = effectiveRadius(baseDock).radiusKm
    expect(screen.getByLabelText(/Coverage radius/)).toHaveValue(String(derived))
  })

  it('caps the slider at the airframe endurance', () => {
    selectDock(baseDock)
    render(<Inspector />)
    const endurance = effectiveRadius(baseDock).enduranceKm
    expect(screen.getByLabelText(/Coverage radius/)).toHaveAttribute(
      'max',
      String(Math.ceil(endurance)),
    )
  })

  it('writes radiusKmOverride when dragged', () => {
    selectDock(baseDock)
    render(<Inspector />)
    fireEvent.change(screen.getByLabelText(/Coverage radius/), { target: { value: '4.5' } })
    expect(usePlanStore.getState().plan.docks[0].radiusKmOverride).toBe(4.5)
  })

  it('reports MANUAL OVERRIDE once dragged', () => {
    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    expect(screen.getByText(/MANUAL OVERRIDE/)).toBeInTheDocument()
    expect(screen.getByText('4.50 KM')).toBeInTheDocument()
  })

  it('offers RESET TO DERIVED only while an override is set', () => {
    selectDock(baseDock)
    const { unmount } = render(<Inspector />)
    expect(screen.queryByRole('button', { name: /RESET TO DERIVED/ })).not.toBeInTheDocument()
    unmount()

    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    expect(screen.getByRole('button', { name: /RESET TO DERIVED/ })).toBeInTheDocument()
  })

  it('clears the override back to derived', () => {
    selectDock({ ...baseDock, radiusKmOverride: 4.5 })
    render(<Inspector />)
    fireEvent.click(screen.getByRole('button', { name: /RESET TO DERIVED/ }))
    expect(usePlanStore.getState().plan.docks[0].radiusKmOverride).toBeUndefined()
  })

  it('extends the slider max rather than lying about an out-of-range stored override', () => {
    // parsePlan deliberately does not validate radiusKmOverride, so an
    // imported or hand-edited plan can carry a value beyond the airframe's
    // reach. The control must show what is stored, not silently clamp it --
    // the same principle as the incompatible-drone option above.
    selectDock({ ...baseDock, radiusKmOverride: 40 })
    render(<Inspector />)
    const slider = screen.getByLabelText(/Coverage radius/)
    expect(slider).toHaveAttribute('max', '40')
    expect(slider).toHaveValue('40')
  })
})
