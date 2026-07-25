// @vitest-environment jsdom
//
// PHASE 1D / TASK 8: coverage for `attachTickerPush` (attachTickerPush.ts,
// wired into EngineProvider.tsx), the ticker-push half of legacy's
// engine.onEvent wiring (main.js:56-57) that moved here from
// useLiveLayers.ts so ticker events accumulate even while the user is on
// another route (this half needs neither the map nor `ready`). Mirrors
// useLiveLayers.test.tsx's (d)/(d2) shape — a fake engine exposing
// `_subscribers` so the subscribe/unsubscribe lifecycle and the
// mapEngineEvent routing can both be asserted without a real SimEngine or a
// React render.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Engine, SimEvent } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import type { AppState } from '@/shared/store'
import { attachTickerPush } from './attachTickerPush'

function createFakeEngine(): Engine {
  const subscribers: ((ev: SimEvent) => void)[] = []
  return {
    docks: new Map(),
    drones: new Map(),
    _subscribers: subscribers,
    onEvent(cb: (ev: SimEvent) => void) {
      subscribers.push(cb)
      return cb
    },
    offEvent(cb: (ev: SimEvent) => void) {
      const i = subscribers.indexOf(cb)
      if (i !== -1) subscribers.splice(i, 1)
    },
  } as unknown as Engine
}

describe('attachTickerPush (EngineProvider.tsx)', () => {
  let originalState: Pick<AppState, 'tickerEvents' | 'pushTickerEvent'>

  beforeEach(() => {
    const s = useAppStore.getState()
    originalState = { tickerEvents: s.tickerEvents, pushTickerEvent: s.pushTickerEvent }
    useAppStore.setState({ tickerEvents: [] })
  })

  afterEach(() => {
    useAppStore.setState(originalState)
  })

  it('adds the engine.onEvent subscription once and removes it on cleanup', () => {
    const engine = createFakeEngine()

    expect(engine._subscribers.length).toBe(0)
    const detach = attachTickerPush(engine)
    expect(engine._subscribers.length).toBe(1)

    detach()
    expect(engine._subscribers.length).toBe(0)
  })

  it('routes each engine event through mapEngineEvent into pushTickerEvent', () => {
    const engine = createFakeEngine()
    const pushTickerEventSpy = vi.fn()
    useAppStore.setState({ pushTickerEvent: pushTickerEventSpy })

    const detach = attachTickerPush(engine)
    const ev: SimEvent = {
      time: 12,
      level: 'alert',
      source: 'D-AUH01',
      message: 'D-AUH01 BATTERY 8% · FORCED RTB',
    }
    engine._subscribers[0](ev)

    expect(pushTickerEventSpy).toHaveBeenCalledTimes(1)
    expect(pushTickerEventSpy.mock.calls[0][0]).toMatchObject({
      level: 'alert',
      source: 'D-AUH01',
      message: 'D-AUH01 BATTERY 8% · FORCED RTB',
      droneId: 'D-AUH01',
    })

    detach()
    engine._subscribers.forEach((cb) => cb(ev)) // no-op: array is empty post-detach
    expect(pushTickerEventSpy).toHaveBeenCalledTimes(1)
  })

  it('a non-drone-sourced event still pushes, with droneId null', () => {
    const engine = createFakeEngine()
    const pushTickerEventSpy = vi.fn()
    useAppStore.setState({ pushTickerEvent: pushTickerEventSpy })

    attachTickerPush(engine)
    const ev: SimEvent = {
      time: 3,
      level: 'info',
      source: 'AUH-01',
      message: 'AUH-01 DOCK READY',
    }
    engine._subscribers[0](ev)

    expect(pushTickerEventSpy.mock.calls[0][0]).toMatchObject({
      source: 'AUH-01',
      droneId: null,
    })
  })
})
