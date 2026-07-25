import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'
import Console from './modules/console/Console'
import EngineProvider from './modules/console/engine/EngineProvider'

// EngineProvider is mounted ABOVE <Routes> (Phase 1C / Task 3 controller
// decision — see EngineProvider.tsx) so the sim engine is a page-lifetime
// singleton that survives `/console` unmounting on navigation back to `/`,
// matching legacy's `window.__engine`. It never unmounts on route change.
export default function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <EngineProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/console" element={<Console />} />
          <Route path="/planner" element={<ModulePlaceholder />} />
          <Route path="/telemetry" element={<ModulePlaceholder />} />
          <Route path="/compliance" element={<ModulePlaceholder />} />
        </Routes>
      </EngineProvider>
    </BrowserRouter>
  )
}
