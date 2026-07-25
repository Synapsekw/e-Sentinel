// Bottom strip, the console ticker's slot: headline numbers that stay
// visible on a projector while working the map. A discriminated
// CoverageResult (see domain/types.ts) means "no AOI yet" and "no docks
// yet" render as real states here instead of NaN%.
//
// `layoutStatus` (optional) surfaces the outcome of the last SUGGEST LAYOUT
// run -- see suggestOutcome.ts's module comment for why this exists
// (Defect 2: the UI used to apply the suggested docks and silently discard
// achievedPct/stoppedBy, so a partial or failed layout looked identical to
// nothing having happened). It renders as its own mono status line
// alongside the headline stats, red only when the outcome is genuinely a
// shortfall or failure, per the console's red-is-reserved-for-brand-and-
// alerts rule.
import type { CoverageResult } from '../domain/types'
import type { SuggestOutcome } from './suggestOutcome'

export interface SummaryStripProps {
  coverage: CoverageResult
  dockCount: number
  layoutStatus?: SuggestOutcome | null
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ps-stat">
      <span className="ps-val">{value}</span>
      <span className="lbl">{label}</span>
    </div>
  )
}

function LayoutStatus({ status }: { status: SuggestOutcome }) {
  return (
    <span className={`lbl ps-layout-status${status.tone === 'alert' ? ' ps-layout-alert' : ''}`}>
      {status.text}
    </span>
  )
}

export default function SummaryStrip({ coverage, dockCount, layoutStatus }: SummaryStripProps) {
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
        {layoutStatus ? <LayoutStatus status={layoutStatus} /> : null}
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
      {layoutStatus ? <LayoutStatus status={layoutStatus} /> : null}
    </div>
  )
}
