import { describe, it, expect } from 'vitest'
import { eventLevel, mapEngineEvent } from './tickerModel'
// appendCapped lives in shared/store.ts (Phase 1C review: shared code must
// not be imported from a feature module, so it moved out of tickerModel.ts).
import { appendCapped } from '@/shared/store'
import type { SimEvent } from '@/modules/console/domain'

describe('ticker model', () => {
  it('eventLevel passes through alert/warn and defaults others to info', () => {
    expect(eventLevel('alert')).toBe('alert')
    expect(eventLevel('warn')).toBe('warn')
    expect(eventLevel('info')).toBe('info')
    expect(eventLevel('debug')).toBe('info')
  })

  it('appendCapped keeps newest-first and caps length', () => {
    let list: number[] = []
    for (let i = 0; i < 35; i++) list = appendCapped(list, i, 30)
    expect(list.length).toBe(30)
    expect(list[0]).toBe(34)
    expect(list[29]).toBe(5)
  })

  it('mapEngineEvent formats time via the injected clock and passes source/message through', () => {
    const ev: SimEvent = { time: 12.5, level: 'info', source: 'OPS', message: 'GRID NOMINAL' }
    const out = mapEngineEvent(ev, () => '08:00:00')
    expect(out).toEqual({
      time: '08:00:00',
      source: 'OPS',
      message: 'GRID NOMINAL',
      level: 'info',
      droneId: null,
    })
  })

  it('mapEngineEvent maps alert/warn levels and derives droneId from a D-* source', () => {
    const alertEv: SimEvent = {
      time: 1,
      level: 'alert',
      source: 'D-AUH01',
      message: 'D-AUH01 BATTERY 8% · FORCED RTB',
    }
    const out = mapEngineEvent(alertEv, () => '09:00:00')
    expect(out.level).toBe('alert')
    expect(out.droneId).toBe('D-AUH01')

    const warnEv: SimEvent = { time: 2, level: 'warn', source: 'D-DXB02', message: 'HOLDING' }
    expect(mapEngineEvent(warnEv, () => '09:00:01').level).toBe('warn')

    const dockEv: SimEvent = { time: 3, level: 'info', source: 'DXB02', message: 'FAULT CLEARED' }
    expect(mapEngineEvent(dockEv, () => '09:00:02').droneId).toBe(null)
  })
})
