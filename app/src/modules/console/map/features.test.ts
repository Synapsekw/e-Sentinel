import { describe, it, expect } from 'vitest'
import { dockFeatures, siteFeatures, coverageFeatures } from './features'

describe('map feature builders', () => {
  it('dockFeatures emits one point per dock with id/state props', () => {
    const fc = dockFeatures()
    expect(fc.features.length).toBe(104)
    expect(fc.features[0].geometry.type).toBe('Point')
    expect(fc.features[0].properties?.state).toBe('ready')
  })
  it('siteFeatures emits one point per site with a status prop', () => {
    const fc = siteFeatures()
    expect(fc.features.length).toBe(19)
    expect(['installed', 'not-installed', 'replace']).toContain(fc.features[0].properties?.status)
  })
  it('coverageFeatures emits one closed polygon ring per dock and site', () => {
    const fc = coverageFeatures()
    expect(fc.features.length).toBe(104 + 19)
    const poly = fc.features[0]
    expect(poly.geometry.type).toBe('Polygon')
  })
})
