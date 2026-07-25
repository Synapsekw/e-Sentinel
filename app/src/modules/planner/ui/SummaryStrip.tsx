// Bottom strip, the console ticker's slot: headline numbers that stay
// visible on a projector while working the map. A discriminated
// CoverageResult (see domain/types.ts) means "no AOI yet" and "no docks
// yet" render as real states here instead of NaN%.
import type { CoverageResult } from '../domain/types'

export interface SummaryStripProps {
  coverage: CoverageResult
  dockCount: number
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ps-stat">
      <span className="ps-val">{value}</span>
      <span className="lbl">{label}</span>
    </div>
  )
}

export default function SummaryStrip({ coverage, dockCount }: SummaryStripProps) {
  if (!coverage.ok) {
    const msg =
      coverage.reason === 'no-aoi'
        ? 'NO AREA OF INTEREST'
        : coverage.reason === 'no-docks'
          ? 'NO DOCKS PLACED'
          : 'GEOMETRY UNAVAILABLE'
    return (
      <div className="planner-summary">
        <span className="lbl">{msg}</span>
      </div>
    )
  }
  return (
    <div className="planner-summary">
      <Stat label="COVERAGE" value={`${Math.round(coverage.coveragePct)}%`} />
      <Stat label="OVERLAP" value={`${Math.round(coverage.overlapPct)}%`} />
      <Stat label="DOCKS" value={String(dockCount)} />
      <Stat label="GAPS" value={String(coverage.gapCount)} />
      <Stat label="AOI KM2" value={String(Math.round(coverage.aoiKm2))} />
    </div>
  )
}
