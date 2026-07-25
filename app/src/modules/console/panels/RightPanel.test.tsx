// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RightPanel from './RightPanel'
import { SimEngine, DATA_DOCKS, DATA_SITES, GEO_UAE } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'

const engine = (() => {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 800; i++) e.tick(0.5)
  return e
})()

describe('RightPanel', () => {
  // Vitest's config doesn't set `test.globals: true`, so @testing-library/
  // react's implicit `afterEach(cleanup)` registration never fires — see
  // chrome/Topbar.test.tsx's identical comment. Without this, DOM from an
  // earlier render in this file is still attached when a later test queries
  // `getByText`/`getByRole`, producing "multiple elements found" failures.
  afterEach(cleanup)

  beforeEach(() => useAppStore.setState({ rightPanel: { mode: 'empty' }, followDroneId: null }))

  it('renders the ops digest by default', () => {
    render(<RightPanel engine={engine} map={null} />)
    expect(document.getElementById('ops-digest')).toBeTruthy()
    expect(screen.getByText(/AIRBORNE/)).toBeTruthy()
  })

  it('renders the dock card for a dock selection', () => {
    const id = DATA_DOCKS[0].id
    useAppStore.setState({ rightPanel: { mode: 'dock', id } })
    render(<RightPanel engine={engine} map={null} />)
    expect(screen.getByText(id)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LOCATE' })).toBeTruthy()
  })

  it('renders the site card with its status chip', () => {
    const site = DATA_SITES[0]
    useAppStore.setState({ rightPanel: { mode: 'site', id: site.id } })
    render(<RightPanel engine={engine} map={null} />)
    // DATA_SITES[0]'s id and name happen to be the identical string
    // ("AAN3198"), so a plain getByText(site.name) ambiguously matches
    // both the .rp-id and .rp-name divs — scope the query to .rp-name.
    expect(document.querySelector('.rp-name')?.textContent).toBe(site.name)
    expect(screen.getByRole('button', { name: 'NEAREST DOCK' })).toBeTruthy()
  })

  it('renders the drone telemetry card for a live drone', () => {
    const d = [...engine.drones.values()].find((x) => x.state !== 'docked')!
    useAppStore.setState({ rightPanel: { mode: 'drone', id: d.id } })
    render(<RightPanel engine={engine} map={null} />)
    expect(screen.getByText(d.id)).toBeTruthy()
    expect(document.querySelectorAll('.tele-cell').length).toBe(6)
    expect(screen.getByRole('button', { name: 'FOLLOW' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'RETURN TO DOCK' })).toBeTruthy()
  })
})
