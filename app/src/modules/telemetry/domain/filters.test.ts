import { describe, it, expect } from 'vitest'
import { filterFlights, sortFlights, aircraftOptions } from './filters'
import { NO_FILTERS } from './types'
import type { FlightMeta } from './types'

function flight(over: Partial<FlightMeta>): FlightMeta {
  return {
    id: 'f',
    file: 'f.txt',
    version: 14,
    encrypted: true,
    hasKeychain: true,
    aircraftName: 'Matrice 400',
    aircraftSn: 'SN1',
    startTime: '2026-02-17T06:27:04.690Z',
    durationS: 100,
    distanceKm: 5,
    maxHeightM: 50,
    maxSpeedMs: 10,
    recordCount: 10,
    home: { lon: 48, lat: 28.78 },
    ...over,
  }
}

const a = flight({
  id: 'a',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04Z',
  durationS: 2722,
  distanceKm: 22.1,
})
const b = flight({
  id: 'b',
  aircraftSn: 'SN2',
  startTime: '2026-02-17T06:52:28Z',
  durationS: 2092,
  distanceKm: 10.6,
})
const c = flight({
  id: 'c',
  aircraftSn: 'SN2',
  startTime: '2026-03-01T08:46:26Z',
  durationS: 1009,
  distanceKm: 6.0,
})
const all = [a, b, c]

describe('filterFlights', () => {
  it('returns everything with no filters', () => {
    expect(filterFlights(all, NO_FILTERS)).toHaveLength(3)
  })

  it('filters by aircraft serial', () => {
    expect(filterFlights(all, { ...NO_FILTERS, aircraftSn: 'SN2' }).map((f) => f.id)).toEqual([
      'b',
      'c',
    ])
  })

  it('filters by start date inclusive of the from day', () => {
    expect(filterFlights(all, { ...NO_FILTERS, from: '2026-02-17' }).map((f) => f.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  // The `to` bound covers the whole named day, not midnight at its start --
  // a user picking 2026-02-17 expects that day's flights included.
  it('includes flights on the to day itself', () => {
    expect(filterFlights(all, { ...NO_FILTERS, to: '2026-02-17' }).map((f) => f.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('filters by minimum duration', () => {
    expect(filterFlights(all, { ...NO_FILTERS, minDurationS: 2000 }).map((f) => f.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('matches text against serial case-insensitively', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'sn2' }).map((f) => f.id)).toEqual(['b', 'c'])
  })

  it('matches text against aircraft name and filename', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'matrice' })).toHaveLength(3)
    expect(filterFlights([a], { ...NO_FILTERS, text: 'f.txt' })).toHaveLength(1)
  })

  it('combines filters conjunctively', () => {
    expect(
      filterFlights(all, { ...NO_FILTERS, aircraftSn: 'SN2', minDurationS: 2000 }).map((f) => f.id),
    ).toEqual(['b'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'nothing' })).toEqual([])
  })
})

describe('sortFlights', () => {
  it('sorts newest first by default ordering', () => {
    expect(sortFlights(all, 'newest').map((f) => f.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts oldest first', () => {
    expect(sortFlights(all, 'oldest').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by duration descending', () => {
    expect(sortFlights(all, 'duration').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by distance descending', () => {
    expect(sortFlights(all, 'distance').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = [c, a, b]
    sortFlights(input, 'newest')
    expect(input.map((f) => f.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('aircraftOptions', () => {
  it('returns one entry per distinct serial, sorted by name then serial', () => {
    expect(aircraftOptions(all)).toEqual([
      { sn: 'SN1', name: 'Matrice 400' },
      { sn: 'SN2', name: 'Matrice 400' },
    ])
  })

  it('is empty for an empty catalog', () => {
    expect(aircraftOptions([])).toEqual([])
  })
})
