// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChromeFade } from './useChromeFade'
import type { ChromeFadeState } from './useChromeFade'
import type { Scene } from '@/shared/store'

describe('useChromeFade', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(0), 16)
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is visible immediately on the console scene', () => {
    const { result } = renderHook(() => useChromeFade('console'))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.hidden).toBe(false)
    expect(result.current.opacity).toBe(1)
  })

  it('starts hidden on the globe scene', () => {
    const { result } = renderHook(() => useChromeFade('globe'))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.hidden).toBe(true)
  })

  it('fades out over 220ms, staying mounted until the timer lands', () => {
    const { result, rerender } = renderHook<ChromeFadeState, { s: Scene }>(
      ({ s }) => useChromeFade(s),
      { initialProps: { s: 'console' } },
    )
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({ s: 'globe' as const })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.opacity).toBe(0)
    expect(result.current.hidden).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.hidden).toBe(true)
  })

  it('a show cancels a pending hide (panels.js:2596-2599)', () => {
    const { result, rerender } = renderHook<ChromeFadeState, { s: Scene }>(
      ({ s }) => useChromeFade(s),
      { initialProps: { s: 'console' } },
    )
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({ s: 'globe' as const })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ s: 'console' as const })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current.hidden).toBe(false)
    expect(result.current.opacity).toBe(1)
  })
})
