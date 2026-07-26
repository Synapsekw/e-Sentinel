// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
// This repo's vite.config.ts sets no `test.setupFiles`, so jest-dom's
// matchers (toBeInTheDocument) are never registered globally -- unlike a
// typical CRA/jest setup, they have to be pulled in per file that uses them.
import '@testing-library/jest-dom/vitest'
import SummaryStrip from './SummaryStrip'

// vite.config.ts now sets test.globals: true, so @testing-library/react's
// auto-cleanup DOES register. This explicit cleanup() is kept anyway: it is
// idempotent, and it keeps this file correct on its own terms rather than
// depending on a config flag holding still (see the same note in
// useCoverageDriver.test.ts / useDockPlacement.test.ts).
afterEach(() => cleanup())

describe('SummaryStrip', () => {
  it('renders a dash placeholder rather than NaN before an AOI exists', () => {
    render(<SummaryStrip coverage={{ ok: false, reason: 'no-aoi' }} dockCount={0} />)
    expect(screen.getByText(/NO AREA OF INTEREST/i)).toBeInTheDocument()
  })

  it('renders the headline numbers once coverage resolves', () => {
    render(
      <SummaryStrip
        coverage={{
          ok: true,
          aoiKm2: 412,
          coveragePct: 87.4,
          overlapPct: 23.1,
          uncovered: { type: 'MultiPolygon', coordinates: [] },
          gapCount: 2,
          perDock: [],
        }}
        dockCount={6}
      />,
    )
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getByText('23%')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('surfaces a partial SUGGEST LAYOUT outcome instead of staying silent (Defect 2)', () => {
    // Before this, suggestLayout's achievedPct/stoppedBy were thrown away by
    // the UI entirely, so a layout that stopped short of the requested
    // coverage (capped, gain floor, exhausted) rendered no differently from
    // a full success or from nothing having run at all.
    render(
      <SummaryStrip
        coverage={{
          ok: true,
          aoiKm2: 40006,
          coveragePct: 7.9,
          overlapPct: 20,
          uncovered: { type: 'MultiPolygon', coordinates: [] },
          gapCount: 5,
          perDock: [],
        }}
        dockCount={40}
        layoutStatus={{ text: 'STOPPED AT 8% · 40 DOCK CAP', tone: 'alert' }}
      />,
    )
    expect(screen.getByText('STOPPED AT 8% · 40 DOCK CAP')).toBeInTheDocument()
  })

  it('renders nothing extra when no SUGGEST LAYOUT has run yet', () => {
    render(
      <SummaryStrip coverage={{ ok: false, reason: 'no-aoi' }} dockCount={0} layoutStatus={null} />,
    )
    expect(screen.queryByText(/DOCK CAP|TARGET MET|NO SITES/)).not.toBeInTheDocument()
  })
})
