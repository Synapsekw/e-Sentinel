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
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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

// Item 5's whole claim is an ORDERING claim -- the busy state is painted
// BEFORE the blocking compute starts -- and the end state after the compute
// is byte-for-byte what it was before this change. So an end-state assertion
// proves nothing; the observation has to be taken from INSIDE the compute.
// This wrapper records what the SUGGEST LAYOUT button looked like at the
// exact moment suggestLayout was entered, then delegates to the REAL
// implementation (importOriginal, not a canned return) so nothing about the
// auto-placement path is faked -- only observed. `vi.hoisted` because
// vi.mock's factory is hoisted above module-level consts.
const spy = vi.hoisted(() => ({
  entries: [] as { label: string; disabled: boolean }[],
}))

vi.mock('@/modules/planner/domain/autoPlace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/autoPlace')>()
  return {
    ...actual,
    suggestLayout: (...args: Parameters<typeof actual.suggestLayout>) => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'PLACING DOCKS' || b.textContent === 'SUGGEST LAYOUT',
      )
      spy.entries.push({
        label: btn?.textContent ?? '(no suggest button in the document)',
        disabled: btn?.disabled ?? false,
      })
      return actual.suggestLayout(...args)
    },
  }
})

// vite.config.ts now sets test.globals: true, so @testing-library/react's
// auto-cleanup DOES register. This explicit cleanup() is kept anyway: it is
// idempotent, it keeps this file correct on its own terms rather than
// depending on a config flag holding still, and the timer reset below has to
// happen here regardless (see useCoverageDriver.test.ts for the same note).
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

describe('PlannerShell SUGGEST LAYOUT busy state (Item 5)', () => {
  // The frames requested by the component, in request order. Handles are
  // 1-based indices into it. Stubbing rather than waiting on real frames is
  // deliberate: this file asserts ORDER, and the project bans wall-clock
  // assertions in tests because they measure the CI machine, not the code.
  let frames: FrameRequestCallback[]
  let cancelled: number[]

  beforeEach(() => {
    frames = []
    cancelled = []
    spy.entries.length = 0
    usePlanStore.setState({
      ...pristineStoreState,
      plan: createPlan(),
      coverage: { ok: false, reason: 'no-aoi' },
      selection: null,
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    // Records the id but deliberately leaves the callback in `frames`, so
    // the unmount test can dispatch an already-scheduled frame anyway and
    // prove the component's own mounted-check stops it -- not just the
    // cancellation.
    vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelled.push(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function suggestButton() {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'PLACING DOCKS' || b.textContent === 'SUGGEST LAYOUT',
    )
    if (!btn) throw new Error('no SUGGEST LAYOUT / PLACING DOCKS button in the document')
    return btn
  }

  it('paints the busy state a full frame before the blocking compute runs, then clears it', () => {
    renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'SUGGEST LAYOUT' }))

    // Synchronously after the click: busy, and the compute has NOT started.
    // Before this change suggestLayout ran here, inside the click handler,
    // so the first thing the browser could paint was already the finished
    // result -- seconds later.
    expect(suggestButton()).toHaveTextContent('PLACING DOCKS')
    expect(suggestButton()).toBeDisabled()
    expect(spy.entries).toHaveLength(0)
    expect(frames).toHaveLength(1)

    // First frame: still nothing computed. This is the assertion that pins
    // the DOUBLE rAF specifically -- an rAF callback runs BEFORE its frame
    // is painted, so a single-rAF implementation would enter the compute
    // right here, with the busy state still unpainted, and this would fail.
    act(() => frames[0](0))
    expect(spy.entries).toHaveLength(0)
    expect(suggestButton()).toHaveTextContent('PLACING DOCKS')
    expect(frames).toHaveLength(2)

    // Second frame: the busy state has been painted, so now the main thread
    // may be blocked. The compute observes itself running while the button
    // is already disabled and reading PLACING DOCKS.
    act(() => frames[1](0))
    expect(spy.entries).toEqual([{ label: 'PLACING DOCKS', disabled: true }])

    // ...and it is cleared once the compute returns.
    expect(suggestButton()).toHaveTextContent('SUGGEST LAYOUT')
    expect(suggestButton()).toBeEnabled()
  })

  it('unmounting mid-yield cancels the pending frame and never runs the compute', () => {
    const { unmount } = renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'SUGGEST LAYOUT' }))
    act(() => frames[0](0))
    expect(frames).toHaveLength(2)

    unmount()

    // The scheduled second frame is cancelled on unmount...
    expect(cancelled).toContain(2)
    // ...and even if it had already been dispatched, the compute bails
    // rather than calling setPlan/setState against a dead component.
    act(() => frames[1](0))
    expect(spy.entries).toHaveLength(0)
  })
})
