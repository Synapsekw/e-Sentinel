import { describe, it, expect } from 'vitest'
import bbox from '@turf/bbox'
import {
  buildPlannerStyle,
  aoiFeatures,
  dockFeatures,
  ringFeatures,
  PLANNER_SOURCES,
} from './plannerStyle'
import { createPlan, addAoi, addDock } from '../domain/plan'
import { effectiveRadius } from '../domain/catalog'
import type { Aoi, PlannedDock } from '../domain/types'
import type { Feature, Polygon, MultiPolygon } from 'geojson'

const aoi: Aoi = {
  id: 'a1',
  name: 'BOX',
  source: 'drawn',
  valid: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.2],
        [54.7, 24.4],
        [54.5, 24.2],
      ],
    ],
  },
}
// A bowtie: the edges (54.5,24.2)->(54.7,24.4) and (54.7,24.2)->(54.5,24.4)
// cross, which is the shape MapLibre's tiler discards.
const invalidAoi: Aoi = {
  id: 'a2',
  name: 'BOWTIE',
  source: 'drawn',
  valid: false,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [54.5, 24.2],
        [54.7, 24.4],
        [54.7, 24.2],
        [54.5, 24.4],
        [54.5, 24.2],
      ],
    ],
  },
}
const dock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
}

describe('buildPlannerStyle', () => {
  it('includes every planner source and no console sim sources', () => {
    const style = buildPlannerStyle()
    for (const id of Object.values(PLANNER_SOURCES)) {
      expect(style.sources[id]).toBeDefined()
    }
    // The planner has no simulation, so it must not inherit these.
    expect(style.sources['drones']).toBeUndefined()
    expect(style.sources['tracks']).toBeUndefined()
    expect(style.sources['wizard-preview']).toBeUndefined()
  })

  it('outlines an invalid AOI in alert red, matching its fill', () => {
    const layers = buildPlannerStyle().layers
    const line = layers.find((l) => l.id === 'planner-aoi-line')
    const fill = layers.find((l) => l.id === 'planner-aoi-fill')
    const valid = ['==', ['get', 'valid'], true]
    expect(line?.type).toBe('line')
    // Same condition and same red as the fill, so outline and wash cannot
    // drift apart.
    expect((line as { paint: Record<string, unknown> }).paint['line-color']).toEqual([
      'case',
      valid,
      '#e8ecf3',
      '#ff5a5a',
    ])
    expect((fill as { paint: Record<string, unknown> }).paint['fill-color']).toEqual([
      'case',
      valid,
      '#e8ecf3',
      '#ff5a5a',
    ])
  })
})

describe('feature builders', () => {
  it('builds one polygon feature per valid AOI', () => {
    const fc = aoiFeatures(addAoi(createPlan(), aoi))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.id).toBe('a1')
  })

  it('passes a valid AOI through with its own geometry untouched', () => {
    // Guards the branch, not the rendering: substituting on the wrong side
    // of the valid test would still produce a drawable polygon, so no
    // assertion about the invalid case would catch it.
    const fc = aoiFeatures(addAoi(createPlan(), aoi))
    expect(fc.features[0].geometry).toEqual(aoi.geometry)
  })

  it('renders an invalid AOI from its bounding box, which the tiler accepts', () => {
    const fc = aoiFeatures(addAoi(createPlan(), invalidAoi))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [54.5, 24.2],
          [54.7, 24.2],
          [54.7, 24.4],
          [54.5, 24.4],
          [54.5, 24.2],
        ],
      ],
    })
    // The paint expressions and the selection hit-test both key off these.
    expect(fc.features[0].properties?.valid).toBe(false)
    expect(fc.features[0].properties?.id).toBe('a2')
    expect(fc.features[0].properties?.name).toBe('BOWTIE')
  })

  it('drops an unboundable AOI without losing its valid siblings', () => {
    const flat: Aoi = {
      ...invalidAoi,
      id: 'a3',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [54.5, 24.2],
            [54.7, 24.2],
            [54.6, 24.2],
            [54.5, 24.2],
          ],
        ],
      },
    }
    const fc = aoiFeatures(addAoi(addAoi(createPlan(), aoi), flat))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.id).toBe('a1')
  })

  it('builds one point feature per dock carrying its source for styling', () => {
    const fc = dockFeatures(addDock(createPlan(), dock))
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.source).toBe('manual')
  })
})

describe('ringFeatures', () => {
  it('produces empty FeatureCollection for empty plan', () => {
    const plan = createPlan()
    const fc = ringFeatures(plan)
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(0)
  })

  it('produces one ring feature per dock with correct id property', () => {
    const plan = addDock(addDock(createPlan(), dock), {
      id: 'd2',
      name: 'D2',
      position: [54.8, 24.5],
      dockModel: 'DOCK3',
      droneModel: 'M4TD',
      environment: 'rural',
      source: 'manual',
    })
    const fc = ringFeatures(plan)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].properties?.id).toBe('d1')
    expect(fc.features[1].properties?.id).toBe('d2')
  })

  it('skips docks with radius <= 0', () => {
    const plan = addDock(addDock(createPlan(), dock), {
      id: 'd2',
      name: 'D2',
      position: [54.8, 24.5],
      dockModel: 'DOCK3',
      droneModel: 'M4TD',
      environment: 'rural',
      source: 'manual',
      radiusKmOverride: 0,
    })
    const fc = ringFeatures(plan)
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.id).toBe('d1')
  })

  it('produces rings with geometry sized proportionally to dock radius', () => {
    // Urban dock (3 km cap), position at [54.6, 24.3]
    const plan = addDock(createPlan(), dock)
    const fc = ringFeatures(plan)
    expect(fc.features).toHaveLength(1)

    const ring = fc.features[0] as Feature<Polygon | MultiPolygon>
    const [minLon, minLat, maxLon, maxLat] = bbox(ring)
    const { radiusKm } = effectiveRadius(dock)

    // Convert km to degrees: roughly 111.2 km per degree of latitude
    const kmPerDegree = 111.2
    const radiusDegrees = radiusKm / kmPerDegree

    // Bounding box should span approximately 2 * radiusKm across both axes
    // (from center minus radius to center plus radius)
    const spanLon = maxLon - minLon
    const spanLat = maxLat - minLat

    // Expect spans to be roughly 2 * radius in degrees, with tolerance
    // for smoothness and rounding (about 0.02 degrees = ~2.2 km tolerance)
    const expectedSpan = 2 * radiusDegrees
    const tolerance = 0.02

    expect(spanLon).toBeGreaterThan(expectedSpan - tolerance)
    expect(spanLon).toBeLessThan(expectedSpan + tolerance)
    expect(spanLat).toBeGreaterThan(expectedSpan - tolerance)
    expect(spanLat).toBeLessThan(expectedSpan + tolerance)
  })

  it('produces rings with many vertices from BUFFER_STEPS=64', () => {
    const plan = addDock(createPlan(), dock)
    const fc = ringFeatures(plan)
    expect(fc.features).toHaveLength(1)

    const ring = fc.features[0] as Feature<Polygon | MultiPolygon>
    const geometry = ring.geometry

    // Count total vertices across all rings (Polygon or MultiPolygon)
    let vertexCount = 0
    if (geometry.type === 'Polygon') {
      // Polygon has coordinates[0] as outer ring, each ring is a closed array
      vertexCount = geometry.coordinates[0]?.length ?? 0
    } else if (geometry.type === 'MultiPolygon') {
      // MultiPolygon: sum vertices from all polygons
      for (const polygon of geometry.coordinates) {
        vertexCount += polygon[0]?.length ?? 0
      }
    }

    // BUFFER_STEPS=64 should produce significantly more vertices than
    // turf's default of 8 steps. A 64-step buffer typically produces
    // 256+ vertices, so even accounting for polygon closure and variety,
    // we expect well over 64 vertices. Use 64 as a lower bound.
    expect(vertexCount).toBeGreaterThan(64)
  })
})

describe('planner-aoi-fill', () => {
  it('exists on the AOI source', () => {
    const style = buildPlannerStyle()
    const fill = style.layers.find((l) => l.id === 'planner-aoi-fill')
    expect(fill).toBeDefined()
    expect(fill?.type).toBe('fill')
    expect((fill as { source?: string }).source).toBe(PLANNER_SOURCES.aoi)
  })

  it('sits below the coverage rings so ring green and gap red read on top', () => {
    const ids = buildPlannerStyle().layers.map((l) => l.id)
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-rings-fill'))
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-gaps-fill'))
  })

  it('keeps the AOI outline above the fill', () => {
    const ids = buildPlannerStyle().layers.map((l) => l.id)
    expect(ids.indexOf('planner-aoi-fill')).toBeLessThan(ids.indexOf('planner-aoi-line'))
  })

  it('carries an alert-colour branch for an invalid ring, even though the tiler drops such rings before it can paint', () => {
    // MapLibre's GeoJSON tiler drops a self-intersecting ring outright, so
    // this branch never actually paints for the invalidity case that occurs
    // in practice -- an invalid AOI renders as nothing, not as a red tint.
    // Pinned here anyway because the expression is still correct for any
    // invalid geometry the tiler does keep, and free to leave in place.
    const fill = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-fill')
    const paint = (fill as { paint?: Record<string, unknown> }).paint ?? {}
    // ['case', ['==', ['get','valid'], true], <valid>, <invalid>]
    const color = paint['fill-color'] as unknown[]
    expect(color[0]).toBe('case')
    expect(color[2]).toBe('#e8ecf3')
    expect(color[3]).toBe('#ff5a5a')
  })

  it('reads the boolean through an explicit == so MapLibre accepts the case condition', () => {
    // ['get','valid'] alone is typed `value`, not `boolean`, and fails style
    // validation as a `case` condition even though the property is a real
    // boolean.
    const fill = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-fill')
    const paint = (fill as { paint?: Record<string, unknown> }).paint ?? {}
    expect((paint['fill-color'] as unknown[])[1]).toEqual(['==', ['get', 'valid'], true])
  })

  it('shares the same valid-check condition between fill-color and fill-opacity', () => {
    // Both paint properties are driven off the shared AOI_VALID constant in
    // plannerStyle.ts -- this pins fill-opacity's condition down too, not
    // just fill-color's, so the two can't silently diverge.
    const fill = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-fill')
    const paint = (fill as { paint?: Record<string, unknown> }).paint ?? {}
    expect((paint['fill-opacity'] as unknown[])[1]).toEqual(['==', ['get', 'valid'], true])
  })
})

describe('planner-rings-line-hi', () => {
  it('exists on the rings source, above the ordinary ring outline', () => {
    const style = buildPlannerStyle()
    const ids = style.layers.map((l) => l.id)
    expect(ids).toContain('planner-rings-line-hi')
    expect(ids.indexOf('planner-rings-line')).toBeLessThan(ids.indexOf('planner-rings-line-hi'))
  })

  it('paints above planner-gaps-fill, so a selected ring is never washed out by the red gap overlay', () => {
    // Both planner-rings-line-hi and planner-aoi-line-hi mean "this is what
    // you selected" and must be equally prominent; the latter already sits
    // above gaps-fill.
    const ids = buildPlannerStyle().layers.map((l) => l.id)
    expect(ids.indexOf('planner-gaps-fill')).toBeLessThan(ids.indexOf('planner-rings-line-hi'))
  })

  it('starts filtered to nothing, so no ring is highlighted before a selection', () => {
    const hi = buildPlannerStyle().layers.find((l) => l.id === 'planner-rings-line-hi')
    expect((hi as { filter?: unknown }).filter).toEqual(['==', ['get', 'id'], ''])
  })

  it('draws thicker than the ordinary ring outline so it reads as selected', () => {
    const layers = buildPlannerStyle().layers
    const paintOf = (id: string) =>
      (layers.find((l) => l.id === id) as { paint?: Record<string, number> }).paint ?? {}
    expect(paintOf('planner-rings-line-hi')['line-width']).toBeGreaterThan(
      paintOf('planner-rings-line')['line-width'],
    )
  })
})

describe('planner-aoi-line-hi', () => {
  it('exists on the aoi source, immediately above the ordinary aoi outline', () => {
    const style = buildPlannerStyle()
    const ids = style.layers.map((l) => l.id)
    expect(ids).toContain('planner-aoi-line-hi')
    expect(ids.indexOf('planner-aoi-line-hi')).toBe(ids.indexOf('planner-aoi-line') + 1)
  })

  it('starts filtered to nothing, so no area is highlighted before a selection', () => {
    const hi = buildPlannerStyle().layers.find((l) => l.id === 'planner-aoi-line-hi')
    expect((hi as { filter?: unknown }).filter).toEqual(['==', ['get', 'id'], ''])
  })

  it('draws solid where the ordinary aoi outline is dashed', () => {
    const layers = buildPlannerStyle().layers
    const paintOf = (id: string) =>
      (layers.find((l) => l.id === id) as { paint?: Record<string, unknown> }).paint ?? {}
    expect(paintOf('planner-aoi-line')['line-dasharray']).toBeDefined()
    expect(paintOf('planner-aoi-line-hi')['line-dasharray']).toBeUndefined()
  })
})
