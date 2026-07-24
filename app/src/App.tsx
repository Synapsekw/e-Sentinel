import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'
import MapView from './modules/console/map/MapView'
import BasemapChip from './modules/console/map/BasemapChip'
import { useAppStore, type MapLayer } from './shared/store'

// Scaffolding for Phase 1B Task 3 verification only: a bare MapView plus a
// layer switcher, standing in for the real console chrome (chip layout,
// globe scene, panels, ...) that later tasks build out. Forces `scene` to
// 'console' on mount so the theater map (not the orbital globe, which
// doesn't exist yet) renders immediately.
const LAYERS: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

function ConsoleScaffold() {
  const setScene = useAppStore((s) => s.setScene)
  const setLayer = useAppStore((s) => s.setLayer)
  const layer = useAppStore((s) => s.layer)

  useEffect(() => {
    setScene('console')
  }, [setScene])

  return (
    <MapView>
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
      </div>
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
