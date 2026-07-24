import { useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'
import MapView from './modules/console/map/MapView'
import BasemapChip from './modules/console/map/BasemapChip'
import GlobeOverlay from './modules/console/globe/GlobeOverlay'
import { useGlobe } from './modules/console/globe/useGlobe'
import { useAppStore, type MapLayer } from './shared/store'

// Scaffolding for Phase 1B Tasks 3-4 verification only: a bare MapView plus
// a layer switcher and an EXIT control, standing in for the real console
// chrome (chip layout, panels, ...) that Task 5 builds out. `scene` now
// boots at its store default ('globe'), so the orbital globe renders first;
// GlobeScene wires the dive-to-theater. The EXIT button is a temporary
// stand-in for the console chrome's real exit control, giving this
// scaffold a way back to orbit for manual verification.
const LAYERS: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

// Calls useGlobe() (which needs useMap()) and renders GlobeOverlay — must
// live inside <MapView> so useMap() resolves.
function GlobeScene() {
  const tagRef = useRef<HTMLButtonElement | null>(null)
  const altRef = useRef<HTMLDivElement | null>(null)
  const { enterTheater, exitToOrbit } = useGlobe({ tagRef, altRef })
  const scene = useAppStore((s) => s.scene)
  const setLayer = useAppStore((s) => s.setLayer)
  const layer = useAppStore((s) => s.layer)

  return (
    <>
      <GlobeOverlay tagRef={tagRef} altRef={altRef} onEnter={enterTheater} />
      {scene === 'console' ? (
        <>
          <BasemapChip />
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
                onClick={() => setLayer(l)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: l === layer ? 'var(--panel2)' : 'var(--panel)',
                  color: 'var(--txt)',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                }}
              >
                {l}
              </button>
            ))}
            <button
              onClick={exitToOrbit}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--panel)',
                color: 'var(--txt)',
                textTransform: 'uppercase',
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            >
              exit
            </button>
          </div>
        </>
      ) : null}
    </>
  )
}

function ConsoleScaffold() {
  return (
    <MapView>
      <GlobeScene />
    </MapView>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/console" element={<ConsoleScaffold />} />
        <Route path="/planner" element={<ModulePlaceholder />} />
        <Route path="/telemetry" element={<ModulePlaceholder />} />
        <Route path="/compliance" element={<ModulePlaceholder />} />
      </Routes>
    </BrowserRouter>
  )
}
