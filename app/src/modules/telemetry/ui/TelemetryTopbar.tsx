// Telemetry chrome. Same arrangement as PlannerTopbar: brand home link and
// offline chip, spacer, then the action row. Only LOAD LOG lives here for
// now -- the basemap LAYERS control that PlannerTopbar and the console both
// place in this slot is Task 27 (see TelemetryTopbar.test.tsx's sibling
// task notes): PlannerLayersMenu reads its layer/setLayer straight off the
// shared useAppStore, so it is not bound to planner *data*, but it renders
// with the pl-btn/pl-menu/pl-menu-item classes that only planner.css
// defines, so it cannot be dropped in here unstyled -- Task 27 needs its
// own tm-* rendering, whether that ends up as a direct copy or a thin
// adapter.
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import OfflineChip from '@/modules/console/OfflineChip'
import './telemetry.css'

export interface TelemetryTopbarProps {
  onLoadFile: (file: File) => void
}

export default function TelemetryTopbar({ onLoadFile }: TelemetryTopbarProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Resetting the value lets the same file be chosen twice in a row, which
    // matters while iterating on one log in a demo.
    e.target.value = ''
    if (file) onLoadFile(file)
  }

  return (
    <header className="tm-topbar">
      <Link className="tm-brand lbl" to="/">
        e& · TELEMETRY
      </Link>
      <OfflineChip />
      <div className="tm-sp" />
      <label className="tm-btn" htmlFor="tm-load">
        LOAD LOG
      </label>
      <input
        id="tm-load"
        type="file"
        accept=".txt"
        aria-label="Load log"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </header>
  )
}
