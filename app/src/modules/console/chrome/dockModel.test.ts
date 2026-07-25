import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import {
  batteryFor,
  stateFor,
  dockMatchesSearch,
  dockStateRank,
  dockListRows,
  groupRows,
} from './dockModel'
import { EMIRATE_ORDER } from './emirates'

function bootedEngine() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 400; i++) e.tick(0.5)
  return e
}

describe('dock list model', () => {
  it('batteryFor falls back to a deterministic 85..99 hash without an engine', () => {
    const a = batteryFor(null, 'AUH-01')
    expect(a).toBe(batteryFor(null, 'AUH-01'))
    expect(a).toBeGreaterThanOrEqual(85)
    expect(a).toBeLessThanOrEqual(99)
  })

  it('batteryFor and stateFor read live engine state when present', () => {
    const e = bootedEngine()
    const seed = DATA_DOCKS[0]
    expect(batteryFor(e, seed.id)).toBe(Math.round(e.docks.get(seed.id)!.battery))
    expect(stateFor(e, seed)).toBe(e.docks.get(seed.id)!.state)
  })

  it('stateFor defaults to ready without an engine', () => {
    expect(stateFor(null, DATA_DOCKS[0])).toBe('ready')
  })

  it('dockMatchesSearch matches id, name, emirate code and emirate name', () => {
    const d = DATA_DOCKS.find((x) => x.emirate === 'DXB')!
    expect(dockMatchesSearch(d, '')).toBe(true)
    expect(dockMatchesSearch(d, d.id.toLowerCase())).toBe(true)
    expect(dockMatchesSearch(d, 'dubai')).toBe(true)
    expect(dockMatchesSearch(d, 'zzzz')).toBe(false)
  })

  it('dockStateRank orders alert < charging < ready < away (panels.js:2057-2062)', () => {
    expect(dockStateRank('fault')).toBe(0)
    expect(dockStateRank('offline')).toBe(0)
    expect(dockStateRank('charging')).toBe(1)
    expect(dockStateRank('ready')).toBe(2)
    expect(dockStateRank('drone-away')).toBe(3)
  })

  it('the ALL/ID listing keeps every dock, clustered by emirate order', () => {
    const rows = dockListRows(null, 'ALL', '', 'ID')
    expect(rows.length).toBe(DATA_DOCKS.length)
    const seen: number[] = rows.map((d) => EMIRATE_ORDER.indexOf(d.emirate))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('an emirate filter keeps only that emirate', () => {
    const rows = dockListRows(null, 'DXB', '', 'ID')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((d) => d.emirate === 'DXB')).toBe(true)
  })

  it('BATT sort is lowest-charge-first', () => {
    const rows = dockListRows(null, 'ALL', '', 'BATT')
    const batts = rows.map((d) => batteryFor(null, d.id))
    expect(batts).toEqual([...batts].sort((a, b) => a - b))
  })

  it('groupRows emits emirate headers only under ID sort', () => {
    const rows = dockListRows(null, 'ALL', '', 'ID')
    const grouped = groupRows(rows, 'ID')
    expect(grouped.filter((g) => g.kind === 'group').length).toBe(EMIRATE_ORDER.length)
    expect(groupRows(rows, 'BATT').every((g) => g.kind === 'row')).toBe(true)
  })
})
