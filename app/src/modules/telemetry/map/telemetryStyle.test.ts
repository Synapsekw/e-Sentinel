import { describe, it, expect } from 'vitest'
import {
  TELEMETRY_SOURCES,
  buildTelemetryStyle,
  pathFeature,
  traversedFeature,
  homeFeature,
  positionFeature,
} from './telemetryStyle'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30,
  distanceKm: 1,
  maxHeightM: 100,
  maxSpeedMs: 10,
  recordCount: 2,
  home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    {
      t: 0,
      lon: 48,
      lat: 28.78,
      alt: 0,
      height: 0,
      speedH: 0,
      speedV: 0,
      heading: 0,
      gimbalPitch: 0,
      battery: 100,
      voltage: 50,
      sats: 20,
      mode: 'GPSAtti',
    },
    {
      t: 30,
      lon: 48.01,
      lat: 28.79,
      alt: 90,
      height: 50,
      speedH: 5,
      speedV: 0,
      heading: 90,
      gimbalPitch: -30,
      battery: 80,
      voltage: 49,
      sats: 32,
      mode: 'GPSWaypoint',
    },
  ],
}

describe('buildTelemetryStyle', () => {
  it('adds every telemetry source on top of the base style', () => {
    const style = buildTelemetryStyle()
    for (const id of Object.values(TELEMETRY_SOURCES)) {
      expect(style.sources[id]).toBeDefined()
    }
  })

  it('keeps the base style layers', () => {
    expect(buildTelemetryStyle().layers.length).toBeGreaterThan(4)
  })

  it('draws the traversed line above the full path', () => {
    const ids = buildTelemetryStyle().layers.map((l) => l.id)
    expect(ids.indexOf('tm-path-traversed')).toBeGreaterThan(ids.indexOf('tm-path-full'))
  })
})

describe('pathFeature', () => {
  it('is an empty collection with no path', () => {
    expect(pathFeature(null).features).toEqual([])
  })

  it('builds a single LineString over every sample', () => {
    const fc = pathFeature(path)
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [48, 28.78],
        [48.01, 28.79],
      ],
    })
  })

  // MapLibre rejects a LineString with fewer than two positions.
  it('emits nothing for a single-sample path', () => {
    expect(pathFeature({ meta, samples: [path.samples[0]] }).features).toEqual([])
  })
})

describe('traversedFeature', () => {
  it('is empty before the flight starts', () => {
    expect(traversedFeature(path, -1).features).toEqual([])
  })

  it('covers the whole path at the end', () => {
    const geom = traversedFeature(path, 30).features[0].geometry
    expect(geom.type).toBe('LineString')
    expect(geom.coordinates).toHaveLength(2)
  })
})

describe('homeFeature', () => {
  it('is empty with no flight', () => {
    expect(homeFeature(null).features).toEqual([])
  })

  it('places a point at the home coordinates', () => {
    expect(homeFeature(meta).features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [48, 28.78],
    })
  })
})

describe('positionFeature', () => {
  it('is empty with no sample', () => {
    expect(positionFeature(null).features).toEqual([])
  })

  it('carries the heading as a property for icon rotation', () => {
    expect(positionFeature(path.samples[1]).features[0].properties?.heading).toBe(90)
  })
})
