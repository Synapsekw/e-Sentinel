// @vitest-environment jsdom
//
// Component-level test for the mutual exclusion Minor 6 (final whole-branch
// review) adds between AOI drawing and dock placement in PlannerShell. Only
// `useMap` (from console/map/MapContext) is mocked: PlannerShell's other
// map-bound hooks (useAoiDraw, useDockPlacement, usePlannerLayers,
// useCoverageDriver) all bail safely on a null mapRef.current (see
// isMapUsable/mapLifecycle.ts and each hook's own `!ready || !map` guard),
// so their REAL implementations run here -- drawMode and dockPlacement.placing
// are ordinary React state, independent of there being a live map instance,
// which is exactly the state this test needs to observe.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
// jest-dom matchers (toBeInTheDocument, toHaveClass) are not registered
// globally by this repo's vite config -- see Inspector.test.tsx/
// SummaryStrip.test.tsx for the same note.
import '@testing-library/jest-dom/vitest'
import { PlannerShell } from './Planner'
import { usePlanStore } from '../store/planStore'
import { createPlan } from '../domain/plan'

vi.mock('@/modules/console/map/MapContext', () => ({
  useMap: () => ({ mapRef: { current: null }, ready: true }),
}))

// Planner.tsx statically imports MapView (console/map/MapView.tsx), which
// statically imports the real 'maplibre-gl' package -- and that package
// calls `window.URL.createObjectURL` at MODULE-EVALUATION time (to register
// its worker), which jsdom does not implement, throwing before a single
// test in this file can even run. MapView itself is never rendered here
// (only PlannerShell, mounted directly with a mocked useMap), so a minimal
// stub is enough: nothing in this test ever constructs a real
// maplibregl.Map.
vi.mock('maplibre-gl', () => ({ default: { Map: class {} } }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

// This suite's vite config does not set test.globals: true, so
// @testing-library/react's auto-cleanup never registers (see
// useCoverageDriver.test.ts for the same note).
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const pristineStoreState = usePlanStore.getState()

function renderShell() {
  return render(
    <MemoryRouter>
      <PlannerShell />
    </MemoryRouter>,
  )
}

describe('PlannerShell tool-mode mutual exclusion (Minor 6)', () => {
  function resetStore() {
    usePlanStore.setState({
      ...pristineStoreState,
      plan: createPlan(),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
  }

  it('standing up a draw mode while dock placement is armed stands placement back down', () => {
    resetStore()
    renderShell()

    const dockButton = screen.getByRole('button', { name: '+ DOCK' })
    fireEvent.click(dockButton)
    expect(dockButton).toHaveClass('active')

    // Open the DRAW dropdown and pick POLYGON.
    fireEvent.click(screen.getByRole('button', { name: /DRAW ▾/ }))
    fireEvent.click(screen.getByRole('button', { name: 'POLYGON' }))

    // Drawing is now armed...
    expect(screen.getByRole('button', { name: /DRAW · POLYGON ▾/ })).toBeInTheDocument()
    // ...and dock placement, which was armed a moment ago, must have been
    // stood back down -- before this fix both stayed armed simultaneously,
    // so a single map click both added a dock and placed a polygon vertex.
    expect(screen.getByRole('button', { name: '+ DOCK' })).not.toHaveClass('active')
  })

  it('arming dock placement while a draw mode is active stands the draw mode back down', () => {
    resetStore()
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: /DRAW ▾/ }))
    fireEvent.click(screen.getByRole('button', { name: 'RECTANGLE' }))
    expect(screen.getByRole('button', { name: /DRAW · RECTANGLE ▾/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ DOCK' }))

    // Dock placement is now armed...
    expect(screen.getByRole('button', { name: '+ DOCK' })).toHaveClass('active')
    // ...and the draw mode must have been stood back down to idle, not left
    // armed alongside it.
    expect(screen.getByRole('button', { name: /DRAW ▾/ })).toBeInTheDocument()
  })
})
