import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './store'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ scene: 'globe', layer: 'dark', offline: false })
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
})
