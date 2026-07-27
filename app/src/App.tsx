import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'
import RouteFallback from './shared/RouteFallback'
import ErrorBoundary from './shared/ErrorBoundary'
import EngineProvider from './modules/console/engine/EngineProvider'

// PHASE 1F: `/console` is the only route that drags in maplibre-gl + the
// baked geo-world/geo-uae data (~1.5MB pre-split — see vite.config.ts's
// manualChunks), and the landing page needs none of it, so it's the one
// route element loaded via React.lazy/dynamic import() instead of a static
// top-of-file import. This only affects the *route element* — Console.tsx's
// own default export stays a plain component (Console.test.tsx imports it
// directly, unlazified, and must keep working). ModulePlaceholder stays a
// static import: it has no heavy dependencies of its own, so lazy-loading it
// would only add a Suspense round-trip for no bundle-size benefit.
const Console = lazy(() => import('./modules/console/Console'))
const Planner = lazy(() => import('./modules/planner/ui/Planner'))
const Telemetry = lazy(() => import('./modules/telemetry/ui/Telemetry'))

// EngineProvider is mounted ABOVE <Routes> (Phase 1C / Task 3 controller
// decision — see EngineProvider.tsx) so the sim engine is a page-lifetime
// singleton that survives `/console` unmounting on navigation back to `/`,
// matching legacy's `window.__engine`. It never unmounts on route change.
// It stays outside the <Suspense> boundary too, for the same reason: routing
// away from `/console` while the lazy chunk is mid-flight (or coming back)
// must never remount/reset the provider.
export default function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <EngineProvider>
        {/* The ErrorBoundary is INSIDE EngineProvider, and must stay there.
            An error boundary replaces its whole subtree when it catches, so a
            boundary placed ABOVE EngineProvider would unmount the provider on
            any uncaught render error and kill the running simulation --
            turning a recoverable route crash into a total loss of sim state,
            and breaking the page-lifetime-singleton invariant above. Do not
            "tidy" it upward. The trade is that a throw from EngineProvider's
            own render body is not caught; that body is a thin context wrapper
            with nothing in it that can throw, and catching it would require
            exactly the placement that kills the engine. */}
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/console" element={<Console />} />
              <Route path="/planner" element={<Planner />} />
              <Route path="/telemetry" element={<Telemetry />} />
              <Route path="/compliance" element={<ModulePlaceholder />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </EngineProvider>
    </BrowserRouter>
  )
}
