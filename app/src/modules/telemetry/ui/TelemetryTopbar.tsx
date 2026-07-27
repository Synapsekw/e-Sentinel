// Telemetry chrome. Same arrangement as PlannerTopbar: brand home link and
// offline chip, spacer, then the action row led by the basemap LAYERS
// control -- the same slot the console and planner both use, so the control
// lives in one place in the user's memory across all three modules. Then
// LOAD LOG.
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import OfflineChip from '@/modules/console/OfflineChip'
import TelemetryLayersMenu from './TelemetryLayersMenu'
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
      <TelemetryLayersMenu />
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
