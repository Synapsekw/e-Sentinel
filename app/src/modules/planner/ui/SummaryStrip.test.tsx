// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
// This repo's vite.config.ts sets no `test.setupFiles`, so jest-dom's
// matchers (toBeInTheDocument) are never registered globally -- unlike a
// typical CRA/jest setup, they have to be pulled in per file that uses them.
import '@testing-library/jest-dom/vitest'
import SummaryStrip from './SummaryStrip'

// This suite's vite config does not set test.globals: true, so
// @testing-library/react's auto-cleanup never registers (see
// useCoverageDriver.test.ts / useDockPlacement.test.ts for the same note).
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
})
