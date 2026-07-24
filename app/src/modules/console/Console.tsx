// Ported (Phase 1B / Task 5). The composed `/console` route: a single
// <MapView> wrapping the globe overlay (Task 4), the ping/FX driver (this
// task), the basemap + offline chips (Tasks 3/5), and a MINIMAL topbar
// placeholder standing in for console.html's real `#topbar` (the four
// layer buttons + EXIT control, transcribed in spirit from the topbar
// skeleton at console.html:24-40). The real topbar/sidebar/right-panel are
// Phase 1D's job — this chrome is intentionally bare scaffolding so the
// globe->theater flow and the map surface are reachable at all.
//
// useBasemap()/useOffline() are already wired inside <MapView> itself
// (Task 3); this component's child only adds the scene-level hooks
// (useGlobe, usePingDriver) that need to run alongside the overlay/chrome,
// matching the shape of Task 3/4's verification scaffold in App.tsx (which
// this component replaces).

import { useRef } from 'react'
import type { CSSProperties } from 'react'
import MapView from './map/MapView'
import BasemapChip from './map/BasemapChip'
import GlobeOverlay from './globe/GlobeOverlay'
import { useGlobe } from './globe/useGlobe'
import { usePingDriver } from './map/usePingDriver'
import OfflineChip from './OfflineChip'
import { useAppStore, type MapLayer } from '@/shared/store'

const LAYERS: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

const chromeButtonStyle = (active: boolean): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: active ? 'var(--panel2)' : 'var(--panel)',
  color: 'var(--txt)',
  textTransform: 'uppercase',
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  cursor: 'pointer',
})

// Calls the hooks that need useMap() (useGlobe, usePingDriver) and renders
// the globe overlay plus the minimal console chrome. Must live inside
// <MapView> so useMap() resolves.
function ConsoleScene() {
  const tagRef = useRef<HTMLButtonElement | null>(null)
  const altRef = useRef<HTMLDivElement | null>(null)
  const enterBtnRef = useRef<HTMLButtonElement | null>(null)
  const { enterTheater, exitToOrbit } = useGlobe({ tagRef, altRef, enterBtnRef })
  usePingDriver()

  const scene = useAppStore((s) => s.scene)
  const layer = useAppStore((s) => s.layer)
  const setLayer = useAppStore((s) => s.setLayer)

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
      {scene === 'console' ? (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: 900,
            display: 'flex',
            gap: 8,
          }}
        >
          {LAYERS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayer(l)}
              style={chromeButtonStyle(l === layer)}
            >
              {l}
            </button>
          ))}
          <button type="button" onClick={exitToOrbit} style={chromeButtonStyle(false)}>
            exit
          </button>
        </div>
      ) : null}
    </>
  )
}

export default function Console() {
  return (
    <MapView>
      <ConsoleScene />
    </MapView>
  )
}
