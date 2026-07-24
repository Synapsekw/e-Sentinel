import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'

export default function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/console" element={<ModulePlaceholder />} />
        <Route path="/planner" element={<ModulePlaceholder />} />
        <Route path="/telemetry" element={<ModulePlaceholder />} />
        <Route path="/compliance" element={<ModulePlaceholder />} />
      </Routes>
    </BrowserRouter>
  )
}
