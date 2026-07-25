// Ported (Phase 1B / Task 5, chrome added Phase 1D / Task 2). The composed
// `/console` route: a single <MapView> wrapping the globe overlay (Task 4),
// the ping/FX driver, the basemap + offline chips (Tasks 3/5), and the real
// console chrome shell (<ConsoleChrome>, Phase 1D / Task 2's port of
// console.html:24-80's `#topbar`/`#side`/`#rpanel`/panel-toggle/`#ticker`
// skeleton). ConsoleChrome is mounted unconditionally (not scene-gated) so
// its own useChromeFade hides/reveals it with the same 220ms/double-rAF fade
// legacy's wireScene drove — gating it on `scene === 'console'` would
// unmount it on every scene flip and lose that transition entirely.
//
// useBasemap()/useOffline() are already wired inside <MapView> itself
// (Task 3); this component's child only adds the scene-level hooks
// (useGlobe, usePingDriver) that need to run alongside the overlay/chrome,
// matching the shape of Task 3/4's verification scaffold in App.tsx (which
// this component replaces).
//
// ConsoleChrome's topbar/sidebar/rightPanel slots are still `null` — Tasks
// 3-7 build the real topbar/sidebar/right-panel contents and are wired in
// here as each lands; until then the layer-switching/exit-to-orbit controls
// that used to live in a bare placeholder div here have no home (Task 4's
// real Topbar restores them via `#btn-layers`/`#btn-globe`). <GridStats/>
// stays scene-gated on its own for now (Task 5 moves it into the sidebar
// slot); <Ticker/> moves into ConsoleChrome's `ticker` slot so it shares the
// same always-mounted/fade-managed lifecycle as the rest of the shell.

import { useEffect, useRef } from 'react'
import MapView from './map/MapView'
import BasemapChip from './map/BasemapChip'
import GlobeOverlay from './globe/GlobeOverlay'
import { useGlobe } from './globe/useGlobe'
import { usePingDriver } from './map/usePingDriver'
import { useLiveLayers } from './engine/useLiveLayers'
import OfflineChip from './OfflineChip'
import GridStats from './hud/GridStats'
import Ticker from './hud/Ticker'
import ConsoleChrome from './chrome/ConsoleChrome'
import { useAppStore } from '@/shared/store'

// Calls the hooks that need useMap() (useGlobe, usePingDriver, useLiveLayers)
// and renders the globe overlay plus the console chrome. Must live inside
// <MapView> so useMap() resolves. useLiveLayers() also needs useEngine(),
// which resolves here too since <EngineProvider> is mounted above the router
// in App.tsx (see EngineProvider.tsx) — outside, and thus above, this entire
// route subtree.
function ConsoleScene() {
  const tagRef = useRef<HTMLButtonElement | null>(null)
  const altRef = useRef<HTMLDivElement | null>(null)
  const enterBtnRef = useRef<HTMLButtonElement | null>(null)
  const { enterTheater } = useGlobe({ tagRef, altRef, enterBtnRef })
  usePingDriver()
  useLiveLayers()

  const scene = useAppStore((s) => s.scene)

  return (
    <>
      <GlobeOverlay
        tagRef={tagRef}
        altRef={altRef}
        enterBtnRef={enterBtnRef}
        onEnter={enterTheater}
      />
      <BasemapChip />
      <OfflineChip />
      <ConsoleChrome topbar={null} sidebar={null} rightPanel={null} ticker={<Ticker />} />
      {scene === 'console' ? <GridStats /> : null}
    </>
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
