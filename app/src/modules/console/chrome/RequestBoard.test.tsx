// @vitest-environment jsdom
// Ported (Phase 1D / Task 6) -- see requestModel.ts / RequestBoard.tsx
// header comments for the legacy line ranges this component transcribes.
//
// One deviation from the plan's literal test source, an environment
// workaround rather than a behavior change:
//    `afterEach(cleanup)`: vitest.config doesn't set `test.globals: true`,
//    so @testing-library/react's implicit `afterEach(cleanup)` registration
//    (which checks for a global `afterEach` at import time) never fires.
//    Every other multi-render suite in this repo (Topbar.test.tsx,
//    Console.test.tsx, Ticker.test.tsx) wires it explicitly for the same
//    reason -- without it, the first test's un-hidden `#req-empty` (no
//    engine -> empty state) is still attached when the second test queries
//    `document.getElementById('req-empty')`, and `getElementById` returns
//    that stale node instead of the second render's.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RequestBoard from './RequestBoard'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'

describe('RequestBoard', () => {
  afterEach(cleanup)

  it('paints the empty state with no engine', () => {
    render(<RequestBoard engine={null} />)
    expect(screen.getByText('NO REQUESTS YET · GRID AT READINESS')).toBeTruthy()
    expect(document.getElementById('req-count')?.hasAttribute('hidden')).toBe(true)
  })

  it('renders a section per non-empty bucket once the engine has requests', () => {
    const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
    for (let i = 0; i < 2000; i++) e.tick(0.5)
    render(<RequestBoard engine={e} />)
    const rows = document.querySelectorAll('.req-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(document.getElementById('req-empty')?.hasAttribute('hidden')).toBe(true)
  })
})
