// Ported (Phase 1B / Task 5, chrome added Phase 1D / Task 2, fully composed
// Phase 1D / Task 8). The composed `/console` route: a single <MapView>
// wrapping the globe overlay (Task 4), the ping/FX driver, the basemap chip
// (Task 3), and the real console chrome shell (<ConsoleChrome>, Phase 1D /
// Task 2's port of console.html:24-80's
// `#topbar`/`#side`/`#rpanel`/panel-toggle/`#ticker` skeleton) now filled in
// with the real <Topbar>/<Sidebar>/<RightPanel>/<Ticker> content built by
// Tasks 4-7. ConsoleChrome is mounted unconditionally (not scene-gated) so
// its own useChromeFade hides/reveals it with the same 220ms/double-rAF fade
// legacy's wireScene drove — gating it on `scene === 'console'` would
// unmount it on every scene flip and lose that transition entirely.
//
// <TopMenus/> (the DOCKS/FILTER/LAYERS dropdowns, Task 5) is mounted
// alongside ConsoleChrome rather than nested inside Topbar: each menu
// portals to `document.body` (TopMenu.tsx), so where it's declared in the
// tree only matters for context resolution (useEngine()/useMap() need to
// resolve for DockList's live battery/state + flyTo) — which this
// component's position inside <MapView> (and beneath App.tsx's
// <EngineProvider>) already satisfies.
//
// useBasemap()/useOffline() are already wired inside <MapView> itself
// (Task 3); this component's child adds the scene-level hooks (useGlobe,
// usePingDriver, useLiveLayers) plus the selection state machine's two
// driver hooks (useMapSelection for map-click -> selectEntity,
// useFollowDriver for the FOLLOW camera), matching the shape of Task 3/4's
// verification scaffold in App.tsx (which this component replaces).
//
// The standalone <OfflineChip/> and <GridStats/> mounts from earlier tasks
// are gone: OfflineChip now renders inside <Topbar> (Task 4) and GridStats
// inside <Sidebar> (Task 6) — mounting either again here would duplicate
// the DOM node.
//
// PHASE 1E / TASK 1: this component now also owns the single
// LiveLayerUpdater instance (previously created lazily inside
// useLiveLayers() itself — see that file's header comment) so it can be
// handed both to useLiveLayers() and out through UpdaterContext, making
// `setRangeHighlight(dockId)` reachable from the manual-control (Task 2)
// and mission-wizard (Task 3) hooks without either needing to call
// useLiveLayers() itself.

import { useEffect, useRef } from 'react'
import MapView from './map/MapView'
import BasemapChip from './map/BasemapChip'
import GlobeOverlay from './globe/GlobeOverlay'
import { useGlobe } from './globe/useGlobe'
import { usePingDriver } from './map/usePingDriver'
import { useLiveLayers } from './engine/useLiveLayers'
import { UpdaterContext } from './engine/UpdaterContext'
import { createLiveLayerUpdater } from './map/updateLiveLayers'
import type { LiveLayerUpdater } from './map/updateLiveLayers'
import Ticker from './hud/Ticker'
import ConsoleChrome from './chrome/ConsoleChrome'
import Topbar from './chrome/Topbar'
import Sidebar from './chrome/Sidebar'
import TopMenus from './chrome/TopMenus'
import RightPanel from './panels'
import { useMapSelection, useFollowDriver, clearSelection } from './selection'
import { useAppStore } from '@/shared/store'

// Calls the hooks that need useMap() (useGlobe, usePingDriver, useLiveLayers,
// useMapSelection, useFollowDriver) and renders the globe overlay plus the
// console chrome. Must live inside <MapView> so useMap() resolves.
// useLiveLayers()/useMapSelection()/useFollowDriver() also need useEngine(),
// which resolves here too since <EngineProvider> is mounted above the router
// in App.tsx (see EngineProvider.tsx) — outside, and thus above, this entire
// route subtree.
function ConsoleScene() {
  const tagRef = useRef<HTMLButtonElement | null>(null)
  const altRef = useRef<HTMLDivElement | null>(null)
  const enterBtnRef = useRef<HTMLButtonElement | null>(null)
  const { enterTheater, exitToOrbit } = useGlobe({ tagRef, altRef, enterBtnRef })

  // Lazily created once via the `if (!ref.current)` guard rather than
  // `useRef(createLiveLayerUpdater())`, so a re-render never evaluates
  // (and immediately discards) a second TrailStore/closure (mirrors
  // updateLiveLayers.ts's own closure-per-mount design).
  const updaterRef = useRef<LiveLayerUpdater | null>(null)
  if (!updaterRef.current) updaterRef.current = createLiveLayerUpdater()
  const updater = updaterRef.current

  usePingDriver()
  useLiveLayers(updater)
  useMapSelection()
  useFollowDriver()

  const scene = useAppStore((s) => s.scene)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)

  // panels.js:2617-2629 (wireScene's globe-scene teardown): leaving the
  // console scene stands down selection/FOLLOW/the right panel and closes
  // any open top-menu dropdown, since #topbar's dropdowns portal to
  // <body> and would otherwise hang open over the (hidden) globe scene.
  useEffect(() => {
    if (scene !== 'console') {
      clearSelection()
      setOpenMenu(null)
    }
  }, [scene, setOpenMenu])

  return (
    <UpdaterContext.Provider value={updater}>
      <GlobeOverlay
        tagRef={tagRef}
        altRef={altRef}
        enterBtnRef={enterBtnRef}
        onEnter={enterTheater}
      />
      <BasemapChip />
      <ConsoleChrome
        topbar={<Topbar onExitToOrbit={exitToOrbit} />}
        sidebar={<Sidebar />}
        rightPanel={<RightPanel />}
        ticker={<Ticker />}
      />
      <TopMenus />
    </UpdaterContext.Provider>
  )
}

export default function Console() {
  // The Zustand store persists across route unmount/remount (it's a module
  // singleton, not React state), so a prior visit's ENTER THEATER can leave
  // scene==='console' sitting in the store after Console unmounts. On a
  // fresh mount, always reset to the orbital boot scene — matching legacy,
  // which always initialized state.scene = 'globe' on page load. Mount-only
  // (empty deps) and independent of map readiness, so it always wins the
  // race against useGlobe's ready-gated boot effect below: on first visit
  // scene is already 'globe' (no-op); on remount-after-theater it correctly
  // restores the orbital boot instead of booting the globe intro camera
  // under console chrome/layers.
  useEffect(() => {
    useAppStore.getState().setScene('globe')
  }, [])

  return (
    <MapView>
      <ConsoleScene />
    </MapView>
  )
}
