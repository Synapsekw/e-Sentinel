// @vitest-environment jsdom
//
// jsdom test (Phase 1B / Task 5): verifies the globe overlay chrome renders
// without a live WebGL map — <GlobeOverlay> only needs the store and its
// own refs, so it can be mounted directly here. The map itself (MapView,
// useGlobe's imperative map calls) is browser-verified via the dev/preview
// checks, not jsdom, since MapLibre requires a real WebGL canvas.
//
// PHASE 1D / TASK 8: the console-chrome composition test below follows the
// same approach — Console.tsx itself always wraps its content in <MapView>,
// which only renders its `children` once MapLibre fires a real 'load' event
// (see MapView.tsx), something jsdom's canvas stub never produces. Rather
// than mocking maplibre-gl (no test file in this codebase does — see
// engine/useLiveLayers.test.tsx and selection/selectEntity.test.ts, which
// both drive fakes at the function level instead), this renders exactly the
// tree Console.tsx's <ConsoleScene> assembles inside <MapView> —
// <ConsoleChrome topbar={<Topbar/>} sidebar={<Sidebar/>}
// rightPanel={<RightPanel/>} ticker={<Ticker/>}/> plus <TopMenus/> — standing
// alone. Every one of those components already resolves its
// engine/map context optionally (falls back to null outside a provider; see
// panels/hooks.ts and chrome/DockList.tsx's header comments), so this is a
// faithful, provider-free stand-in for "the console scene, scene-gated".

// Both trees below are wrapped in MemoryRouter: the brand block in <Topbar>
// and in <GlobeOverlay> is a react-router <Link> back to the module landing
// page (there is otherwise no route out of /console -- #btn-globe only flips
// the scene), and <Link> throws outside a router.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAppStore } from '@/shared/store'
import type { AppState } from '@/shared/store'
import GlobeOverlay from './globe/GlobeOverlay'
import ConsoleChrome from './chrome/ConsoleChrome'
import Topbar from './chrome/Topbar'
import Sidebar from './chrome/Sidebar'
import TopMenus from './chrome/TopMenus'
import RightPanel from './panels'
import Ticker from './hud/Ticker'

afterEach(cleanup)

describe('globe overlay chrome', () => {
  function renderGlobeOverlay(): void {
    render(
      <MemoryRouter>
        <GlobeOverlay
          onEnter={() => {}}
          tagRef={{ current: null }}
          altRef={{ current: null }}
          enterBtnRef={{ current: null }}
        />
      </MemoryRouter>,
    )
  }

  it('shows the ENTER THEATER control in the globe scene', () => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    renderGlobeOverlay()
    expect(screen.getByRole('button', { name: /enter theater/i })).toBeTruthy()
  })

  // The orbital scene hides the topbar entirely (useChromeFade), so this brand
  // is the only way back to the landing page from the boot scene.
  it('the orbital brand block is a link to the landing page', () => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    renderGlobeOverlay()
    const brand = screen.getByText('SENTINEL').closest('a')
    expect(brand?.getAttribute('href')).toBe('/')
    expect(brand?.querySelector('img.g-logo')).toBeTruthy()
  })
})

describe('console chrome composition (Console.tsx / Phase 1D Task 8)', () => {
  const chromeIds = ['topbar', 'side', 'rpanel', 'ticker', 'side-toggle', 'rpanel-toggle']
  let originalState: Pick<AppState, 'scene' | 'tickerEvents'>

  beforeEach(() => {
    const s = useAppStore.getState()
    originalState = { scene: s.scene, tickerEvents: s.tickerEvents }
  })

  afterEach(() => {
    // Unmount BEFORE restoring the store. vitest runs afterEach hooks in
    // reverse registration order, and @testing-library/react registers its
    // auto-cleanup hook at import time (line 25) — i.e. before this one — so
    // auto-cleanup runs LAST, after this hook. Restoring the store first
    // would therefore push an update into a tree that is still mounted, from
    // outside act(). That was always true; it only became *visible* once
    // vite.config.ts enabled `test.globals`, because RTL only flips
    // IS_REACT_ACT_ENVIRONMENT on when `beforeAll`/`afterAll` exist as
    // globals for it to hook. cleanup() is idempotent, so the later
    // auto-cleanup pass and the file-level afterEach(cleanup) both stay fine.
    cleanup()
    useAppStore.setState(originalState)
  })

  function renderConsoleTree(): void {
    render(
      <MemoryRouter>
        <ConsoleChrome
          topbar={<Topbar onExitToOrbit={() => {}} />}
          sidebar={<Sidebar />}
          rightPanel={<RightPanel />}
          ticker={<Ticker />}
        />
        <TopMenus />
      </MemoryRouter>,
    )
  }

  it('renders #topbar/#side/#rpanel/#ticker + panel toggles, visible in the console scene', () => {
    // #ticker additionally gates its own `hidden` on tickerEvents.length
    // (Ticker.tsx) independent of scene, so this needs at least one event.
    useAppStore.setState({
      scene: 'console',
      tickerEvents: [
        {
          id: 1,
          time: '00:00:00',
          source: 'AUH-01',
          message: 'READY',
          level: 'info',
          droneId: null,
        },
      ],
    })
    renderConsoleTree()

    for (const id of chromeIds) {
      const el = document.getElementById(id)
      expect(el, `#${id} should exist`).toBeTruthy()
      expect(el?.hasAttribute('hidden'), `#${id} should not be hidden`).toBe(false)
    }
  })

  it('renders the same elements hidden in the globe scene', () => {
    // #ticker's own `hidden` attribute is driven only by tickerEvents.length
    // (Ticker.tsx), not scene — its *wrapper* (ConsoleChrome's chrome-in div)
    // is what carries the scene-driven hidden here. Leaving tickerEvents
    // empty (the real state on a fresh globe-scene boot) means both gates
    // agree #ticker is hidden, so the loop below still holds for it; the
    // wrapper is asserted explicitly right after for the case an event has
    // already landed while off-console.
    useAppStore.setState({ scene: 'globe', tickerEvents: [] })
    renderConsoleTree()

    for (const id of chromeIds) {
      const el = document.getElementById(id)
      expect(el, `#${id} should exist`).toBeTruthy()
      expect(el?.hasAttribute('hidden'), `#${id} should be hidden`).toBe(true)
    }

    const tickerWrapper = document.getElementById('ticker')?.parentElement
    expect(tickerWrapper?.hasAttribute('hidden'), 'ticker wrapper should be scene-hidden').toBe(
      true,
    )
  })
})
