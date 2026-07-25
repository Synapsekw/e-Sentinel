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

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
  it('shows the ENTER THEATER control in the globe scene', () => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
    render(
      <GlobeOverlay
        onEnter={() => {}}
        tagRef={{ current: null }}
        altRef={{ current: null }}
        enterBtnRef={{ current: null }}
      />,
    )
    expect(screen.getByRole('button', { name: /enter theater/i })).toBeTruthy()
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
    useAppStore.setState(originalState)
  })

  function renderConsoleTree(): void {
    render(
      <>
        <ConsoleChrome
          topbar={<Topbar onExitToOrbit={() => {}} />}
          sidebar={<Sidebar />}
          rightPanel={<RightPanel />}
          ticker={<Ticker />}
        />
        <TopMenus />
      </>,
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
