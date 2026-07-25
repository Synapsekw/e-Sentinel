// @vitest-environment jsdom
//
// TASK 4 REVIEW FIX: regression coverage for the "ticker auto-scroll dead on
// the primary flow" bug. Ticker.tsx used to `return null` whenever
// `tickerEvents` was empty — which is the state on every fresh boot — so the
// auto-scroll effect (startTickerDriver, panels.js:2209-2229; empty deps
// array, matching legacy's one-time bind) ran its single pass against
// `streamRef.current === null` and bailed via `if (!stream) return`. Because
// the effect never re-runs, the scroll loop stayed permanently unbound even
// once events later arrived and `#tickstream` appeared in the DOM. The fix
// always renders `#ticker`/`#tickstream` (toggling the `hidden` attribute
// instead of unmounting, matching legacy console.html's always-present
// `<footer id="ticker">`) so `streamRef` attaches on first mount.
//
// This suite renders with an EMPTY store (mirroring the real boot sequence),
// pushes an event in afterwards, and drives a manual requestAnimationFrame
// queue — same stubbing pattern as ../engine/useLiveLayers.test.tsx — to
// prove the loop is bound to the real DOM node and running. Against the
// buggy `return null` version, `scrollLeft` never advances because the
// frame() closure captured `stream = null` at mount.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useAppStore } from '@/shared/store'
import type { AppState } from '@/shared/store'
import Ticker from './Ticker'

function pushSampleEvent(): void {
  useAppStore.getState().pushTickerEvent({
    time: '00:00:01',
    source: 'D-AUH01',
    message: 'D-AUH01 LAUNCH',
    level: 'info',
    droneId: 'D-AUH01',
  })
}

// jsdom reports scrollWidth/clientWidth as 0 for every element (no real
// layout engine), which would make the driver's `max <= 4` short-circuit
// look identical whether the loop is bound or dead. Stub a scrollable
// geometry so an advancing `scrollLeft` is unambiguous evidence the rAF loop
// is alive and mutating the real node.
function setScrollGeometry(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
}

describe('Ticker auto-scroll (hud/Ticker.tsx)', () => {
  let rafQueue: Map<number, FrameRequestCallback>
  let rafSeq: number
  let originalTickerEvents: AppState['tickerEvents']

  beforeEach(() => {
    originalTickerEvents = useAppStore.getState().tickerEvents
    useAppStore.setState({ tickerEvents: [] })

    rafQueue = new Map()
    rafSeq = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback): number => {
        rafSeq += 1
        rafQueue.set(rafSeq, cb)
        return rafSeq
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number): void => {
        rafQueue.delete(id)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useAppStore.setState({ tickerEvents: originalTickerEvents })
  })

  // Mirrors a single browser frame: runs every callback currently queued via
  // the stubbed requestAnimationFrame. frame() re-queues itself each call,
  // so one flush() drains exactly the frame scheduled since the last flush.
  function flush(ts: number): void {
    const entries = [...rafQueue.entries()]
    rafQueue.clear()
    for (const [, cb] of entries) cb(ts)
  }

  it('renders #ticker/#tickstream from first mount (hidden, not unmounted) even with an empty store', () => {
    const { container } = render(<Ticker />)

    const footer = container.querySelector('#ticker')
    const stream = container.querySelector('#tickstream')
    expect(footer).toBeTruthy()
    expect(stream).toBeTruthy()
    expect((footer as HTMLElement).hidden).toBe(true)
  })

  it('binds the auto-scroll driver on mount so it is already running once events arrive', () => {
    const { container } = render(<Ticker />)
    const footer = container.querySelector<HTMLElement>('#ticker')
    const stream = container.querySelector<HTMLElement>('#tickstream')
    // Guard clauses (rather than letting a null-deref throw below): against
    // the buggy `return null`-when-empty version neither node exists yet at
    // this point, so these assertions are where that version actually fails.
    expect(footer).toBeTruthy()
    expect(stream).toBeTruthy()
    if (!footer || !stream) return
    setScrollGeometry(stream, 1000, 300)

    act(() => {
      pushSampleEvent()
    })
    expect(footer.hidden).toBe(false)

    expect(stream.scrollLeft).toBe(0)
    // Against the buggy `return null`-when-empty version, streamRef.current
    // was null when the effect's single pass ran at mount, so this loop was
    // never bound to a real node and scrollLeft stays 0 forever.
    flush(0)
    flush(16)
    flush(32)
    expect(stream.scrollLeft).toBeGreaterThan(0)
  })

  it('pauses the scroll on mouseover (hover) and resumes on mouseout', () => {
    pushSampleEvent()
    const { container } = render(<Ticker />)
    const stream = container.querySelector('#tickstream') as HTMLElement
    setScrollGeometry(stream, 1000, 300)

    flush(0)
    flush(16)
    const afterRun = stream.scrollLeft
    expect(afterRun).toBeGreaterThan(0)

    // onMouseEnter is implemented by React via native mouseover/mouseout
    // delegation (not native mouseenter/mouseleave, which don't bubble) —
    // fireEvent.mouseOver/mouseOut is the event pair that actually reaches
    // the onMouseEnter/onMouseLeave handlers below.
    fireEvent.mouseOver(stream)
    flush(32)
    flush(48)
    expect(stream.scrollLeft).toBe(afterRun)

    fireEvent.mouseOut(stream)
    flush(64)
    expect(stream.scrollLeft).toBeGreaterThan(afterRun)
  })

  it('wraps scrollLeft back to 0 once it reaches the end of the strip', () => {
    pushSampleEvent()
    const { container } = render(<Ticker />)
    const stream = container.querySelector('#tickstream') as HTMLElement
    setScrollGeometry(stream, 100, 90) // max = 10, well within one frame's SPEED
    stream.scrollLeft = 9.8

    flush(0)
    expect(stream.scrollLeft).toBe(0)
  })
})
