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
      controlMode: 'normal',
      controlActiveId: null,
      controlFollowWasAuto: false,
      wizard: null,
      userMissions: [],
      sessionMissions: [],
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

  it('exposes Phase 1E control-slice defaults (control.js:9-19)', () => {
    const s = useAppStore.getState()
    expect(s.controlMode).toBe('normal')
    expect(s.controlActiveId).toBe(null)
    expect(s.controlFollowWasAuto).toBe(false)
    expect(s.wizard).toBe(null)
    expect(s.userMissions).toEqual([])
    expect(s.sessionMissions).toEqual([])
  })

  it('setControlMode / setControlFollowWasAuto / setWizard update only their own fields', () => {
    const wizard = {
      step: 1 as const,
      type: null,
      dockId: 'AUH-01',
      points: [],
      spacingM: 150,
      altM: null,
      speedMs: null,
      error: null,
      rangeWarning: null,
    }
    useAppStore.getState().setControlMode('manual', 'D-AUH-01')
    useAppStore.getState().setControlFollowWasAuto(true)
    useAppStore.getState().setWizard(wizard)
    const s = useAppStore.getState()
    expect(s.controlMode).toBe('manual')
    expect(s.controlActiveId).toBe('D-AUH-01')
    expect(s.controlFollowWasAuto).toBe(true)
    expect(s.wizard).toEqual(wizard)
    // Untouched slices from beforeEach stay put.
    expect(s.userMissions).toEqual([])
    expect(s.scene).toBe('globe')
  })

  it('addUserMission appends without duplicates', () => {
    useAppStore.getState().addUserMission('M-001')
    useAppStore.getState().addUserMission('M-002')
    useAppStore.getState().addUserMission('M-001')
    expect(useAppStore.getState().userMissions).toEqual(['M-001', 'M-002'])
  })

  it('pushSessionMission prepends newest-first and caps at 40', () => {
    function fakeMission(id: string) {
      return {
        id,
        type: 'security',
        dockId: 'AUH-01',
        waypoints: [],
        params: { altM: 80, speedMs: 12 },
        progress: 1,
        state: 'complete',
        analytics: null,
        startedAt: 0,
        distanceKm: 0,
        durationS: 0,
        _milestones: {},
      } as unknown as ReturnType<typeof useAppStore.getState>['sessionMissions'][number]
    }
    for (let i = 0; i < 41; i++) useAppStore.getState().pushSessionMission(fakeMission('M-' + i))
    const s = useAppStore.getState()
    expect(s.sessionMissions.length).toBe(40)
    expect(s.sessionMissions[0].id).toBe('M-40')
  })
})
