import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      scene: 'globe',
      layer: 'dark',
      offline: false,
      rightPanel: { mode: 'empty' },
      dockFilter: 'ALL',
      dockSearch: '',
      dockSort: 'ID',
      sideCollapsed: false,
      rpanelCollapsed: false,
      openMenu: null,
    })
  })

  it('defaults to the orbital globe scene on the dark basemap', () => {
    const s = useAppStore.getState()
    expect(s.scene).toBe('globe')
    expect(s.layer).toBe('dark')
    expect(s.offline).toBe(false)
  })

  it('setScene / setLayer / setOffline update state', () => {
    useAppStore.getState().setScene('console')
    useAppStore.getState().setLayer('sat')
    useAppStore.getState().setOffline(true)
    const s = useAppStore.getState()
    expect(s.scene).toBe('console')
    expect(s.layer).toBe('sat')
    expect(s.offline).toBe(true)
  })

  it('exposes Phase 1D chrome defaults', () => {
    const s = useAppStore.getState()
    expect(s.rightPanel).toEqual({ mode: 'empty' })
    expect(s.dockFilter).toBe('ALL')
    expect(s.dockSearch).toBe('')
    expect(s.dockSort).toBe('ID')
    expect(s.sideCollapsed).toBe(false)
    expect(s.rpanelCollapsed).toBe(false)
    expect(s.openMenu).toBe(null)
  })

  it('toggles panel collapse independently', () => {
    useAppStore.getState().toggleSideCollapsed()
    expect(useAppStore.getState().sideCollapsed).toBe(true)
    expect(useAppStore.getState().rpanelCollapsed).toBe(false)
    useAppStore.getState().toggleSideCollapsed()
    expect(useAppStore.getState().sideCollapsed).toBe(false)
  })

  it('setRightPanel / setDockFilter / setDockSearch / setDockSort / setOpenMenu update only their own field', () => {
    useAppStore.getState().setRightPanel({ mode: 'dock', id: 'AUH-001' })
    useAppStore.getState().setDockFilter('DXB')
    useAppStore.getState().setDockSearch('marina')
    useAppStore.getState().setDockSort('BATT')
    useAppStore.getState().setOpenMenu('docks')
    const s = useAppStore.getState()
    expect(s.rightPanel).toEqual({ mode: 'dock', id: 'AUH-001' })
    expect(s.dockFilter).toBe('DXB')
    expect(s.dockSearch).toBe('marina')
    expect(s.dockSort).toBe('BATT')
    expect(s.openMenu).toBe('docks')
    // Untouched slices from beforeEach stay put.
    expect(s.scene).toBe('globe')
    expect(s.rpanelCollapsed).toBe(false)
  })
})
