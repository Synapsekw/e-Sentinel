// @vitest-environment jsdom
//
// TASK 4 EXTRA: automated coverage for the rAF render loop, its 1 Hz
// grid-stats throttle, and the engine.onEvent attach/detach — none of which
// had a test before (they were only browser-verified in Task 3; this
// sandbox's rAF never actually fires, so a jsdom+fake-timers test is the
// only way to exercise the loop's logic in CI). `startRenderLoop` and
// `attachEngineEvents` (useLiveLayers.ts) were pulled out of the hook
// specifically so they can be driven here with a fake engine/map/updater and
// a hand-rolled requestAnimationFrame queue, instead of needing a real
// MapLibre canvas or a React harness threaded through
// EngineProvider+MapView. No .tsx/React rendering is actually needed for
// this coverage — the file keeps the .tsx extension only because it lives
// alongside useLiveLayers.ts's module (a plain .ts would do equally well).
//
// PHASE 1D / TASK 8: the ticker-push assertion that used to live here
// ("(d2) routes each engine event through mapEngineEvent into
// pushTickerEvent") moved to EngineProvider.test.tsx along with the
// production code it covers (attachTickerPush) — see this file's
// useLiveLayers.ts header comment. What's left here ((d)/(d2) below) covers
// the half that stayed: the subscribe/unsubscribe lifecycle and the
// MISSION_LAUNCHED -> pushLaunchPulse (fxPulses) branch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type maplibregl from 'maplibre-gl'
import type { Engine, SimEvent } from '@/modules/console/domain'
import type { LiveLayerUpdater } from '@/modules/console/map/updateLiveLayers'
import { useAppStore } from '@/shared/store'
import type { AppState } from '@/shared/store'
import { fxPulses } from '@/modules/console/map/fx'
import { DATA_DOCKS } from '@/modules/console/domain'
import { startRenderLoop, attachEngineEvents, STATS_INTERVAL_MS } from './useLiveLayers'

function createFakeMap(): maplibregl.Map {
  const stubSource = { setData: vi.fn() }
  return {
    getSource: vi.fn(() => stubSource),
    getLayer: vi.fn(() => undefined),
    setFilter: vi.fn(),
  } as unknown as maplibregl.Map
}

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

// Returns the LiveLayerUpdater alongside a standalone reference to its
// `update` mock. Tests assert on `updateSpy` directly rather than
// `updater.update` — reading a vi.fn() through a property typed via
// LiveLayerUpdater's method-shorthand signature trips
// @typescript-eslint/unbound-method (it can't tell a mock apart from a real
// bound method), where a plain local variable holding the same mock doesn't.
function createFakeUpdater(): { updater: LiveLayerUpdater; updateSpy: ReturnType<typeof vi.fn> } {
  const updateSpy = vi.fn()
  const updater: LiveLayerUpdater = { update: updateSpy, setRangeHighlight: vi.fn() }
  return { updater, updateSpy }
}

describe('render loop + event subscription (useLiveLayers.ts)', () => {
  let rafQueue: Map<number, FrameRequestCallback>
  let rafSeq: number
  let rafSpy: ReturnType<typeof vi.fn>
  let cafSpy: ReturnType<typeof vi.fn>
  let originalState: Pick<
    AppState,
    | 'scene'
    | 'selection'
    | 'followDroneId'
    | 'stats'
    | 'tickerEvents'
    | 'setStats'
    | 'pushTickerEvent'
  >

  beforeEach(() => {
    const s = useAppStore.getState()
    originalState = {
      scene: s.scene,
      selection: s.selection,
      followDroneId: s.followDroneId,
      stats: s.stats,
      tickerEvents: s.tickerEvents,
      setStats: s.setStats,
      pushTickerEvent: s.pushTickerEvent,
    }
    useAppStore.setState({
      scene: 'console',
      selection: null,
      followDroneId: null,
      stats: { ready: 0, flying: 0, charge: 0, alert: 0 },
      tickerEvents: [],
    })

    rafQueue = new Map()
    rafSeq = 0
    rafSpy = vi.fn((cb: FrameRequestCallback): number => {
      rafSeq += 1
      rafQueue.set(rafSeq, cb)
      return rafSeq
    })
    cafSpy = vi.fn((id: number): void => {
      rafQueue.delete(id)
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', cafSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAppStore.setState(originalState)
  })

  // Executes every callback currently queued via the stubbed
  // requestAnimationFrame, passing `ts` as its timestamp — mirrors a single
  // browser frame. startRenderLoop's frame() re-queues itself each call, so
  // one flush() drains exactly the frames scheduled since the last flush.
  function flush(ts: number): void {
    const entries = [...rafQueue.entries()]
    rafQueue.clear()
    for (const [, cb] of entries) cb(ts)
  }

  it('(a) calls the updater once per frame with the current selection/followDroneId/ready', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const { updater, updateSpy } = createFakeUpdater()

    const stop = startRenderLoop(engine, map, updater, true)
    flush(0)
    flush(16)
    flush(32)

    expect(updateSpy).toHaveBeenCalledTimes(3)
    expect(updateSpy).toHaveBeenLastCalledWith(engine, map, null, null, true)
    stop()
  })

  it('(b) throttles setStats to at most ~once per second of frame-timestamp time', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const { updater, updateSpy } = createFakeUpdater()
    const setStatsSpy = vi.fn()
    useAppStore.setState({ setStats: setStatsSpy })

    const stop = startRenderLoop(engine, map, updater, true)
    // 9 frames of irregular rAF timestamps spanning ~2.6s of frame-time
    // (not a clean multiple of STATS_INTERVAL_MS, matching how real rAF
    // timestamps land relative to a fixed throttle window). The
    // >1000ms-since-last-push condition is crossed exactly twice: at
    // ts=1100 (1100ms since lastStatsAt=0) and again at ts=2200 (1100ms
    // since lastStatsAt=1100) — every other frame lands inside the window.
    for (const ts of [0, 200, 500, 900, 1100, 1600, 1999, 2200, 2600]) flush(ts)

    expect(setStatsSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledTimes(9)
    stop()
  })

  it('(b2) never fires before STATS_INTERVAL_MS of frame-time has elapsed', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const { updater } = createFakeUpdater()
    const setStatsSpy = vi.fn()
    useAppStore.setState({ setStats: setStatsSpy })

    const stop = startRenderLoop(engine, map, updater, true)
    flush(0)
    flush(STATS_INTERVAL_MS - 1)
    expect(setStatsSpy).not.toHaveBeenCalled()
    flush(STATS_INTERVAL_MS + 1)
    expect(setStatsSpy).toHaveBeenCalledTimes(1)
    stop()
  })

  it('(c) cancels the pending frame on cleanup and schedules no further frames', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const { updater, updateSpy } = createFakeUpdater()

    const stop = startRenderLoop(engine, map, updater, true)
    flush(0)
    expect(updateSpy).toHaveBeenCalledTimes(1)

    stop()
    expect(cafSpy).toHaveBeenCalledTimes(1)

    // No frame left queued to flush; the loop must not have rescheduled.
    flush(16)
    expect(updateSpy).toHaveBeenCalledTimes(1)
  })

  it('(d) adds the engine.onEvent subscription once and removes it on cleanup', () => {
    const engine = createFakeEngine()
    const mapRef = { current: null }

    expect(engine._subscribers.length).toBe(0)
    const detach = attachEngineEvents(engine, mapRef, true)
    expect(engine._subscribers.length).toBe(1)

    detach()
    expect(engine._subscribers.length).toBe(0)
  })

  it('(d2) routes a MISSION_LAUNCHED event into pushLaunchPulse (fxPulses)', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const mapRef = { current: map }
    const dockId = DATA_DOCKS[0].id
    const startLen = fxPulses.length

    const detach = attachEngineEvents(engine, mapRef, true)
    const ev: SimEvent = {
      time: 12,
      level: 'info',
      source: dockId,
      message: dockId + ' MISSION LAUNCHED',
      code: 'MISSION_LAUNCHED',
      dockId,
    }
    engine._subscribers[0](ev)

    expect(fxPulses.length).toBe(startLen + 1)
    fxPulses.length = startLen // don't leak a pulse into later tests

    detach()
    engine._subscribers.forEach((cb) => cb(ev)) // no-op: array is empty post-detach
    expect(fxPulses.length).toBe(startLen)
  })

  it('(d3) a non-launch event does not push a pulse', () => {
    const engine = createFakeEngine()
    const map = createFakeMap()
    const mapRef = { current: map }
    const startLen = fxPulses.length

    attachEngineEvents(engine, mapRef, true)
    const ev: SimEvent = {
      time: 12,
      level: 'alert',
      source: 'D-AUH01',
      message: 'D-AUH01 BATTERY 8% · FORCED RTB',
    }
    engine._subscribers[0](ev)

    expect(fxPulses.length).toBe(startLen)
  })
})
