// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import DockList from './DockList'
import { DATA_DOCKS } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'

describe('DockList', () => {
  beforeEach(() => {
    useAppStore.setState({
      dockFilter: 'ALL',
      dockSearch: '',
      dockSort: 'ID',
      selection: null,
      rightPanel: { mode: 'empty' },
      openMenu: 'docks',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders one row per dock plus emirate group headers', () => {
    render(<DockList />)
    expect(document.querySelectorAll('.dock-row').length).toBe(DATA_DOCKS.length)
    expect(document.querySelectorAll('.dock-group').length).toBeGreaterThan(0)
  })

  it('search narrows the list and shows the empty note when nothing matches', () => {
    render(<DockList />)
    const input = screen.getByLabelText('Search docks')
    act(() => {
      fireEvent.input(input, { target: { value: 'zzzz' } })
    })
    expect(document.querySelectorAll('.dock-row').length).toBe(0)
    expect(screen.getByText('NO DOCKS MATCH THIS FILTER')).toBeTruthy()
  })

  it('clicking a row with no airborne drone selects the dock and closes the menu', () => {
    render(<DockList />)
    const row = document.querySelector('.dock-row') as HTMLButtonElement
    const id = row.dataset.dockId!
    act(() => {
      row.click()
    })
    expect(useAppStore.getState().selection).toEqual({ type: 'dock', id })
    expect(useAppStore.getState().openMenu).toBe(null)
  })

  it('marks the selected dock row', () => {
    useAppStore.setState({ selection: { type: 'dock', id: DATA_DOCKS[0].id } })
    render(<DockList />)
    const sel = document.querySelector('.dock-row.sel') as HTMLElement
    expect(sel.dataset.dockId).toBe(DATA_DOCKS[0].id)
  })

  it('switching sort to BATT drops the emirate headers', () => {
    render(<DockList />)
    act(() => {
      screen.getByRole('button', { name: 'BATT' }).click()
    })
    expect(document.querySelectorAll('.dock-group').length).toBe(0)
  })
})
